import { Router } from "express";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { gamedays, players, registrations } from "../db/schema";
import { ApiError } from "../utils/errors";
import { asyncHandler } from "../utils/asyncHandler";
import { countConfirmed, notifyOnWaitlistChange, recomputeGamedayWaitlist, type WaitlistRecomputeResult } from "../services/registrationService";
import { isPastLocalDay } from "../utils/timezone";
import { effectiveGamedayStatus } from "../utils/gamedayStatus";
import { recordAccessEvent } from "../services/accessEventService";
import { nameTakenByAnotherPlayer } from "./auth";

const router = Router();

const LEAGUE_TIMEZONE = "Europe/Vienna";

/**
 * Public - anyone holding the link, no auth. Deliberately returns only what
 * a stranger needs to decide whether to sign up (date, status, headcount) -
 * never who's registered, and none of the authenticated detail view's admin
 * controls. See gamedays.ts's POST /:id/share-link for how the token itself
 * is issued.
 *
 * The link expires at the end of game day (Vienna time), not after some
 * fixed duration from creation - it stays valid for however long the
 * matchday is still upcoming, then stops working the day after.
 */
async function loadGamedayByShareToken(token: string) {
  const gameday = await db.query.gamedays.findFirst({ where: eq(gamedays.shareToken, token) });
  if (!gameday) throw ApiError.notFound("This link isn't valid");
  if (isPastLocalDay(gameday.date, LEAGUE_TIMEZONE)) throw ApiError.gone("This link has expired - the matchday has already happened.");
  return gameday;
}

/**
 * `?playerId=` is how a guest who signed up earlier (remembered client-side,
 * see JoinGameday.tsx) sees their own current status on revisiting the same
 * link - not a secret, just a lookup key scoped to this one already-public
 * gameday's roster, so a wrong/guessed id reveals nothing beyond "are they
 * registered for this specific matchday".
 */
router.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const gameday = await loadGamedayByShareToken(req.params.token);
    const active = await db.query.registrations.findMany({
      where: and(eq(registrations.gamedayId, gameday.id), ne(registrations.status, "CANCELLED")),
      with: { player: true },
    });
    const confirmed = active.filter((r) => r.status === "CONFIRMED");
    const waitlisted = active.filter((r) => r.status === "WAITLISTED");

    const playerId = req.query.playerId ? parseInt(req.query.playerId as string, 10) : null;
    const mine = playerId ? active.find((r) => r.playerId === playerId) : undefined;

    res.json({
      gameday: {
        id: gameday.id,
        date: gameday.date,
        status: effectiveGamedayStatus(gameday),
        minPlayers: gameday.minPlayers,
        maxPlayers: gameday.maxPlayers,
        confirmedCount: confirmed.length,
        waitlistedCount: waitlisted.length,
        confirmed: confirmed.map((r) => ({ name: r.player.name, isGuest: r.player.isGuest })),
        waitlisted: waitlisted.map((r) => ({ name: r.player.name, isGuest: r.player.isGuest })),
        myStatus: mine?.status ?? null,
      },
    });
  })
);

/**
 * Existing guest names (system-wide, same pool the authenticated "bring a
 * guest" picker uses) minus anyone already actively registered for this
 * particular gameday - lets an unauthenticated guest pick themselves (or a
 * friend) from a list instead of risking a near-duplicate name, same as the
 * logged-in flow's datalist. Names only - no ids or other player data.
 */
router.get(
  "/:token/guests",
  asyncHandler(async (req, res) => {
    const gameday = await loadGamedayByShareToken(req.params.token);
    const allGuests = await db.query.players.findMany({
      where: eq(players.isGuest, true),
      orderBy: (p, { asc }) => asc(p.name),
    });
    const activeRegs = await db.query.registrations.findMany({
      where: and(eq(registrations.gamedayId, gameday.id), ne(registrations.status, "CANCELLED")),
    });
    const registeredPlayerIds = new Set(activeRegs.map((r) => r.playerId));
    const names = allGuests.filter((g) => !registeredPlayerIds.has(g.id)).map((g) => g.name);
    res.json({ names });
  })
);

const registerGuestSchema = z.object({
  name: z.string().min(1).max(255),
});

/**
 * Registers a guest (by name, no account) for this gameday - the "I don't
 * have an account" path on the share-link page. A registered player is
 * expected to log in and use the normal authenticated register endpoint
 * instead, so their signup is attributed to their real account/history.
 */
router.post(
  "/:token/register-guest",
  asyncHandler(async (req, res) => {
    const gameday = await loadGamedayByShareToken(req.params.token);
    if (effectiveGamedayStatus(gameday) !== "OPEN") throw ApiError.badRequest("This matchday is no longer open for sign-ups");

    const parsed = registerGuestSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Enter your name");
    const name = parsed.data.name.trim();

    let guest = await db.query.players.findFirst({
      where: and(eq(players.isGuest, true), sql`lower(${players.name}) = lower(${name})`),
    });
    if (!guest) {
      // This name might belong to a player who *used* to be a guest by this
      // name - already promoted (merged, or via a guest-linked invite) - in
      // which case it must never silently become a second, duplicate guest.
      if (await nameTakenByAnotherPlayer(name, null)) {
        throw ApiError.conflict("This name already belongs to a registered player - please log in instead to sign up.");
      }
      [guest] = await db.insert(players).values({ name, isGuest: true }).returning();
    }

    const existing = await db.query.registrations.findFirst({
      where: and(eq(registrations.gamedayId, gameday.id), eq(registrations.playerId, guest.id)),
    });
    if (existing && existing.status !== "CANCELLED") {
      throw ApiError.conflict("This name is already registered for this matchday");
    }

    const confirmedCountBefore = await countConfirmed(gameday.id);
    let waitlistResult: WaitlistRecomputeResult | null = null;
    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(registrations)
          .set({ status: "CONFIRMED", signupAt: new Date(), cancelledAt: null })
          .where(eq(registrations.id, existing.id));
      } else {
        await tx.insert(registrations).values({
          gamedayId: gameday.id,
          playerId: guest!.id,
          // No authenticated actor performed this - attribute it to whoever
          // created the gameday, same as the historical importer does.
          registeredByUserId: gameday.createdByUserId,
          status: "CONFIRMED",
        });
      }
      waitlistResult = await recomputeGamedayWaitlist(tx, gameday.id);
    });

    const finalReg = await db.query.registrations.findFirst({
      where: and(eq(registrations.gamedayId, gameday.id), eq(registrations.playerId, guest.id)),
    });

    await recordAccessEvent({
      req,
      eventType: "GUEST_REGISTER",
      isGuest: true,
      playerId: guest.id,
      playerName: guest.name,
      userId: null,
    });
    res.status(201).json({ status: finalReg?.status ?? "CONFIRMED", playerId: guest.id });
    notifyOnWaitlistChange(gameday, confirmedCountBefore, waitlistResult).catch((err) =>
      console.error("notifyOnWaitlistChange failed:", err)
    );
  })
);

export default router;
