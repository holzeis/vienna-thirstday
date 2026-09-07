import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { invites, players, users } from "../db/schema";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { generateInviteToken, defaultInviteExpiry, INVITE_DEFAULT_EXPIRY_DAYS } from "../utils/inviteToken";

const router = Router();

router.use(requireAuth, requireAdmin);

function computeInviteStatus(invite: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  return invite.revokedAt
    ? ("revoked" as const)
    : invite.usedAt
      ? ("used" as const)
      : invite.expiresAt.getTime() < Date.now()
        ? ("expired" as const)
        : ("pending" as const);
}

function serializeInvite(invite: {
  id: number;
  token: string;
  note: string | null;
  guestPlayer: { id: number; name: string } | null;
  createdBy: { id: number; email: string | null };
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: { id: number; email: string | null } | null;
  revokedAt: Date | null;
  createdAt: Date;
  redemptions: { id: number; playerId: number | null; playerName: string; createdAt: Date }[];
}) {
  return {
    id: invite.id,
    token: invite.token,
    note: invite.note,
    guestPlayer: invite.guestPlayer ? { id: invite.guestPlayer.id, name: invite.guestPlayer.name } : null,
    // Pick only the safe fields - the `with` relation include below hands us
    // the full raw user row (passwordHash included), so never spread it.
    createdBy: { id: invite.createdBy.id, email: invite.createdBy.email },
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
    usedBy: invite.usedBy ? { id: invite.usedBy.id, email: invite.usedBy.email } : null,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
    status: computeInviteStatus(invite),
    // Who's actually joined via this link - the only "used" signal an open
    // (reusable, no-guest) invite has, and a more complete one than usedBy
    // even for a guest-linked invite.
    redemptions: invite.redemptions.map((r) => ({ id: r.id, playerId: r.playerId, playerName: r.playerName, createdAt: r.createdAt })),
  };
}

/** All invites, newest first - used to populate the admin "Invites" list. */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await db.query.invites.findMany({
      with: {
        guestPlayer: true,
        createdBy: true,
        usedBy: true,
        redemptions: { orderBy: (r, { asc }) => asc(r.createdAt) },
      },
      orderBy: (i, { desc }) => desc(i.createdAt),
    });
    res.json({ invites: rows.map(serializeInvite) });
  })
);

const createSchema = z.object({
  // Every invite either starts from an existing guest/placeholder player
  // (promoted in place, never merged into a separately-created player) or,
  // when omitted, is an "open" invite - reusable by multiple people, each
  // onboarding as a genuinely new player with no history. An admin can
  // attach a guest's history to one of those afterward via the ordinary
  // merge tool (POST /admin/players/:targetPlayerId/merge).
  guestPlayerId: z.number().int().optional(),
  // Optional free-text reminder for the admin's own benefit, never shown to
  // the person accepting the invite.
  note: z.string().max(255).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw ApiError.badRequest("Invalid invite payload", parsed.error.flatten());
    const { guestPlayerId, note, expiresInDays } = parsed.data;

    if (guestPlayerId !== undefined) {
      const guest = await db.query.players.findFirst({ where: eq(players.id, guestPlayerId) });
      if (!guest) throw ApiError.notFound("Player not found");
      if (!guest.isGuest) throw ApiError.badRequest("This player has already been onboarded or is otherwise not a guest");
      const alreadyLinked = await db.query.users.findFirst({ where: eq(users.playerId, guestPlayerId) });
      if (alreadyLinked) throw ApiError.badRequest("This player already has an account");
    }

    const created = await db.transaction(async (tx) => {
      if (guestPlayerId !== undefined) {
        // "The admin selects a guest and onboards him as a player" happens
        // now, at invite creation - not deferred to accept time.
        await tx.update(players).set({ isGuest: false }).where(eq(players.id, guestPlayerId));
      }

      const [invite] = await tx
        .insert(invites)
        .values({
          token: generateInviteToken(),
          note: note || null,
          guestPlayerId: guestPlayerId ?? null,
          createdByUserId: req.user!.userId,
          expiresAt: defaultInviteExpiry(expiresInDays ?? INVITE_DEFAULT_EXPIRY_DAYS),
        })
        .returning();
      return invite;
    });

    const withRelations = await db.query.invites.findFirst({
      where: eq(invites.id, created.id),
      with: { guestPlayer: true, createdBy: true, usedBy: true, redemptions: true },
    });

    res.status(201).json({ invite: serializeInvite(withRelations!) });
  })
);

/**
 * Revokes an invite so its link stops working. A guest-linked invite that's
 * already been used can't be revoked - the account already exists, and
 * revoking would only affect future use, which there is none of. An open
 * invite, though, can always be revoked regardless of how many people have
 * already joined via it - that's the whole point of revoking a reusable
 * link, and it never touches accounts already created through it.
 */
router.post(
  "/:id/revoke",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const invite = await db.query.invites.findFirst({ where: eq(invites.id, id) });
    if (!invite) throw ApiError.notFound("Invite not found");
    if (invite.usedAt) throw ApiError.badRequest("This invite was already used and can't be revoked");

    await db.transaction(async (tx) => {
      await tx.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
      // Only a guest-linked invite has a promotion to revert - an open
      // invite never touched a guest in the first place.
      if (invite.guestPlayerId) {
        await tx.update(players).set({ isGuest: true }).where(eq(players.id, invite.guestPlayerId));
      }
    });

    const withRelations = await db.query.invites.findFirst({
      where: eq(invites.id, id),
      with: { guestPlayer: true, createdBy: true, usedBy: true, redemptions: true },
    });
    res.json({ invite: serializeInvite(withRelations!) });
  })
);

/**
 * Removes an invite that's no longer actionable (used/accepted, expired, or
 * revoked) - just tidying up the list. A still-pending invite's link is
 * live, so it must be revoked first rather than deleted out from under it.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const invite = await db.query.invites.findFirst({ where: eq(invites.id, id) });
    if (!invite) throw ApiError.notFound("Invite not found");
    if (computeInviteStatus(invite) === "pending") {
      throw ApiError.badRequest("This invite is still pending - revoke it before removing it");
    }

    await db.delete(invites).where(eq(invites.id, id));
    res.status(204).send();
  })
);

export default router;
