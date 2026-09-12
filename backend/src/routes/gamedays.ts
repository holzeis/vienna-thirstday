import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { gamedays, players, registrations, results, teamAssignments, playerGamedayStats, users } from "../db/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/errors";
import { countConfirmed, notifyOnWaitlistChange, recomputeGamedayWaitlist, type WaitlistRecomputeResult } from "../services/registrationService";
import { notifyCreatorOfRegistrationChange, notifyGamedayCancelled, notifyNewGameday } from "../services/pushService";
import { generateInviteToken } from "../utils/inviteToken";
import { computeTeamResult } from "../utils/scoring";
import { computeMatchdayNumbers } from "../utils/matchday";
import { effectiveGamedayStatus } from "../utils/gamedayStatus";
import { computeCurrentForm, computeIsNewcomer, computeSeasonPodiums, fetchStatRows } from "../services/playerStatsService";

const router = Router();

router.use(requireAuth);

const createGamedaySchema = z.object({
  date: z.string().datetime().or(z.string().min(1)),
  minPlayers: z.number().int().min(2).optional(),
  maxPlayers: z.number().int().min(2).optional(),
  notes: z.string().optional(),
});

router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = createGamedaySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid gameday data", parsed.error.flatten());
    const { date, minPlayers, maxPlayers, notes } = parsed.data;

    const [gameday] = await db
      .insert(gamedays)
      .values({
        date: new Date(date),
        minPlayers: minPlayers ?? 8,
        maxPlayers: maxPlayers ?? 14,
        notes,
        createdByUserId: req.user!.userId,
      })
      .returning();
    res.status(201).json({ gameday });
    // Fire-and-forget: push delivery is a real network round-trip per
    // subscriber and must never add latency to the caller's response.
    notifyNewGameday(db, gameday).catch((err) => console.error("notifyNewGameday failed:", err));
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const seasonParam = req.query.season as string | undefined;
    const me = await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) });
    const myPlayerId = me?.playerId ?? null;

    const all = await db.query.gamedays.findMany({
      orderBy: (g, { asc }) => asc(g.date),
      with: {
        registrations: { where: ne(registrations.status, "CANCELLED") },
        result: { with: { playerStats: true } },
      },
    });

    // `all` is ascending by date (the query's orderBy above), which
    // computeMatchdayNumbers requires.
    const matchdayById = computeMatchdayNumbers(all);

    const filtered = seasonParam
      ? all.filter((g) => g.date.getUTCFullYear() === parseInt(seasonParam, 10))
      : all;

    const summarized = filtered
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((g) => {
        const regs = (g as any).registrations as { status: string }[];
        const result = (g as any).result as
          | { teamAScore: number; teamBScore: number; playerStats: { playerId: number }[] }
          | null;
        const played = myPlayerId ? (result?.playerStats.some((s) => s.playerId === myPlayerId) ?? false) : false;
        return {
          id: g.id,
          date: g.date,
          status: effectiveGamedayStatus(g),
          minPlayers: g.minPlayers,
          maxPlayers: g.maxPlayers,
          matchday: matchdayById.get(g.id)!,
          confirmedCount: regs.filter((r) => r.status === "CONFIRMED").length,
          waitlistedCount: regs.filter((r) => r.status === "WAITLISTED").length,
          result: g.status === "COMPLETED" && result ? { teamAScore: result.teamAScore, teamBScore: result.teamBScore } : null,
          played,
        };
      });

    res.json({ gamedays: summarized });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const gameday = await db.query.gamedays.findFirst({
      where: eq(gamedays.id, id),
      with: {
        registrations: {
          with: { player: true, registeredBy: true },
          orderBy: [asc(registrations.signupAt)],
        },
        teamAssignments: { with: { player: true } },
        result: { with: { playerStats: { with: { player: true } } } },
      },
    });
    if (!gameday) throw ApiError.notFound("Gameday not found");

    // Same Locker Room / champion badges shown on the leaderboard, so a
    // registered player is recognizable here too - "previous season"
    // relative to this gameday's own year, same rule as the standings page.
    const allRows = await fetchStatRows(db);
    const gamedayYear = new Date(gameday.date).getUTCFullYear();
    const previousSeasonRows = await fetchStatRows(db, { year: gamedayYear - 1 });
    const previousRanking = computeSeasonPodiums(previousSeasonRows).ranking;
    const previousChampionId = previousRanking.gold?.playerId ?? null;
    const previousViceChampionId = previousRanking.silver?.playerId ?? null;
    function playerBadges(playerId: number) {
      return {
        currentForm: computeCurrentForm(allRows, playerId),
        isNewcomer: computeIsNewcomer(allRows.filter((r) => r.playerId === playerId)),
        previousSeasonTitle:
          playerId === previousChampionId ? "champion" : playerId === previousViceChampionId ? "viceChampion" : null,
      };
    }

    const regs = (gameday as any).registrations as any[];
    res.json({
      gameday: {
        ...gameday,
        status: effectiveGamedayStatus(gameday),
        registrations: regs
          .filter((r) => r.status !== "CANCELLED")
          .map((r) => ({
            id: r.id,
            status: r.status,
            signupAt: r.signupAt,
            player: { id: r.player.id, name: r.player.name, isGuest: r.player.isGuest, ...playerBadges(r.player.id) },
            // Null once the registering user's own account is later deleted
            // - the registration itself (and who it's for) is unaffected.
            registeredBy: r.registeredBy ? { id: r.registeredBy.id, email: r.registeredBy.email } : null,
          })),
      },
    });
  })
);

/**
 * Returns this gameday's public share link token, generating and persisting
 * one on first request (most gamedays are never shared, so there's no
 * reason to generate one at creation time). Idempotent - a second call
 * returns the same token.
 */
router.post(
  "/:id/share-link",
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const gameday = await db.query.gamedays.findFirst({ where: eq(gamedays.id, id) });
    if (!gameday) throw ApiError.notFound("Gameday not found");

    if (gameday.shareToken) {
      res.json({ shareToken: gameday.shareToken });
      return;
    }

    const shareToken = generateInviteToken();
    await db.update(gamedays).set({ shareToken }).where(eq(gamedays.id, id));
    res.json({ shareToken });
  })
);

const updateGamedaySchema = z.object({
  date: z.string().optional(),
  minPlayers: z.number().int().min(2).optional(),
  maxPlayers: z.number().int().min(2).optional(),
  notes: z.string().optional(),
  status: z.enum(["OPEN", "CLOSED", "CANCELLED", "COMPLETED"]).optional(),
});

router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = updateGamedaySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid update", parsed.error.flatten());

    const { date, ...rest } = parsed.data;
    const updateValues: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (date) updateValues.date = new Date(date);

    const [updated] = await db.update(gamedays).set(updateValues).where(eq(gamedays.id, id)).returning();
    if (!updated) throw ApiError.notFound("Gameday not found");

    // If capacity changed, re-evaluate the waitlist.
    if (rest.maxPlayers !== undefined) {
      const confirmedCountBefore = await countConfirmed(id);
      let waitlistResult: WaitlistRecomputeResult | null = null;
      await db.transaction(async (tx) => {
        waitlistResult = await recomputeGamedayWaitlist(tx, id);
      });
      res.json({ gameday: updated });
      notifyOnWaitlistChange(updated, confirmedCountBefore, waitlistResult).catch((err) =>
        console.error("notifyOnWaitlistChange failed:", err)
      );
      return;
    }

    res.json({ gameday: updated });
  })
);

/**
 * Admin cancels a gameday (e.g. too few players signed up) - unlike delete,
 * this keeps the gameday and its registrations around as a historical
 * record, just flagged CANCELLED. Notifies everyone currently registered
 * (confirmed or waitlisted).
 */
router.post(
  "/:id/cancel",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const gameday = await db.query.gamedays.findFirst({ where: eq(gamedays.id, id) });
    if (!gameday) throw ApiError.notFound("Gameday not found");
    if (gameday.status === "CANCELLED") throw ApiError.conflict("This matchday is already cancelled");
    if (gameday.status === "COMPLETED") throw ApiError.badRequest("This matchday has already been played");

    const activeRegs = await db.query.registrations.findMany({
      where: and(eq(registrations.gamedayId, id), ne(registrations.status, "CANCELLED")),
    });

    const [updated] = await db
      .update(gamedays)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(gamedays.id, id))
      .returning();

    res.json({ gameday: updated });
    notifyGamedayCancelled(
      db,
      activeRegs.map((r) => r.playerId),
      updated
    ).catch((err) => console.error("notifyGamedayCancelled failed:", err));
  })
);

/** Admin deletes a gameday outright; registrations/teams/results/stats cascade with it. */
router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const [deleted] = await db.delete(gamedays).where(eq(gamedays.id, id)).returning();
    if (!deleted) throw ApiError.notFound("Gameday not found");
    res.status(204).send();
  })
);

const registerSchema = z.object({
  playerId: z.number().int().optional(),
});

/** Register the current user (or one of their guests) for a gameday. */
router.post(
  "/:id/register",
  asyncHandler(async (req, res) => {
    const gamedayId = parseInt(req.params.id, 10);
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw ApiError.badRequest("Invalid request");

    const gameday = await db.query.gamedays.findFirst({ where: eq(gamedays.id, gamedayId) });
    if (!gameday) throw ApiError.notFound("Gameday not found");
    if (effectiveGamedayStatus(gameday) !== "OPEN") throw ApiError.badRequest("This gameday is not open for registration");

    let playerId = parsed.data.playerId;
    if (playerId === undefined) {
      const me = await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) });
      if (!me?.playerId) throw ApiError.badRequest("Your account has no player profile to register with");
      playerId = me.playerId;
    } else {
      const guest = await db.query.players.findFirst({ where: eq(players.id, playerId) });
      if (!guest) throw ApiError.notFound("Player/guest not found");
      // Guests are a shared, system-wide pool (including ones imported from
      // the legacy spreadsheet) so anyone can bring one along, regardless of
      // who originally added that guest profile.
    }

    const existing = await db.query.registrations.findFirst({
      where: and(eq(registrations.gamedayId, gamedayId), eq(registrations.playerId, playerId)),
    });
    if (existing && existing.status !== "CANCELLED") {
      throw ApiError.conflict("This player is already registered for this gameday");
    }

    const confirmedCountBefore = await countConfirmed(gamedayId);
    let waitlistResult: WaitlistRecomputeResult | null = null;
    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(registrations)
          .set({ status: "CONFIRMED", signupAt: new Date(), cancelledAt: null, registeredByUserId: req.user!.userId })
          .where(eq(registrations.id, existing.id));
      } else {
        await tx.insert(registrations).values({
          gamedayId,
          playerId: playerId!,
          registeredByUserId: req.user!.userId,
          status: "CONFIRMED",
        });
      }
      waitlistResult = await recomputeGamedayWaitlist(tx, gamedayId);
    });

    res.status(201).json({ message: "Registered" });
    notifyOnWaitlistChange(gameday, confirmedCountBefore, waitlistResult).catch((err) =>
      console.error("notifyOnWaitlistChange failed:", err)
    );
    // Skip telling the creator about their own click - they already know.
    if (req.user!.userId !== gameday.createdByUserId) {
      notifyCreatorOfRegistrationChange(db, gameday, playerId!, "signed_up").catch((err) =>
        console.error("notifyCreatorOfRegistrationChange failed:", err)
      );
    }
  })
);

/** Cancel a registration (self, own guest, or admin on behalf of anyone). */
router.delete(
  "/:id/register/:registrationId",
  asyncHandler(async (req, res) => {
    const gamedayId = parseInt(req.params.id, 10);
    const registrationId = parseInt(req.params.registrationId, 10);

    const reg = await db.query.registrations.findFirst({
      where: and(eq(registrations.id, registrationId), eq(registrations.gamedayId, gamedayId)),
    });
    if (!reg) throw ApiError.notFound("Registration not found");

    if (reg.registeredByUserId !== req.user!.userId && !req.user!.isAdmin) {
      throw ApiError.forbidden("You can only cancel registrations you made");
    }

    const gameday = await db.query.gamedays.findFirst({ where: eq(gamedays.id, gamedayId) });
    const confirmedCountBefore = await countConfirmed(gamedayId);

    let waitlistResult: WaitlistRecomputeResult | null = null;
    await db.transaction(async (tx) => {
      await tx
        .update(registrations)
        .set({ status: "CANCELLED", cancelledAt: new Date() })
        .where(eq(registrations.id, registrationId));
      waitlistResult = await recomputeGamedayWaitlist(tx, gamedayId);
    });

    res.status(204).send();
    if (gameday) {
      notifyOnWaitlistChange(gameday, confirmedCountBefore, waitlistResult).catch((err) =>
        console.error("notifyOnWaitlistChange failed:", err)
      );
      // Skip telling the creator about their own click - they already know.
      if (req.user!.userId !== gameday.createdByUserId) {
        notifyCreatorOfRegistrationChange(db, gameday, reg.playerId, "cancelled").catch((err) =>
          console.error("notifyCreatorOfRegistrationChange failed:", err)
        );
      }
    }
  })
);

const teamsSchema = z.object({
  assignments: z.array(
    z.object({
      playerId: z.number().int(),
      team: z.enum(["A", "B"]),
    })
  ),
});

/** Admin sets/replaces the team rosters for a gameday. */
router.put(
  "/:id/teams",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const gamedayId = parseInt(req.params.id, 10);
    const parsed = teamsSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid teams payload", parsed.error.flatten());

    const gameday = await db.query.gamedays.findFirst({ where: eq(gamedays.id, gamedayId) });
    if (!gameday) throw ApiError.notFound("Gameday not found");

    await db.transaction(async (tx) => {
      await tx.delete(teamAssignments).where(eq(teamAssignments.gamedayId, gamedayId));
      if (parsed.data.assignments.length > 0) {
        await tx.insert(teamAssignments).values(
          parsed.data.assignments.map((a) => ({ gamedayId, playerId: a.playerId, team: a.team }))
        );
      }
    });

    res.json({ message: "Teams updated" });
  })
);

const resultSchema = z.object({
  teamAScore: z.number().int().min(0),
  teamBScore: z.number().int().min(0),
});

/** Admin enters the final score; points/goal-diff are computed from current team assignments. */
router.put(
  "/:id/result",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const gamedayId = parseInt(req.params.id, 10);
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest("Invalid result payload", parsed.error.flatten());

    const gameday = await db.query.gamedays.findFirst({ where: eq(gamedays.id, gamedayId) });
    if (!gameday) throw ApiError.notFound("Gameday not found");

    const assignments = await db.query.teamAssignments.findMany({ where: eq(teamAssignments.gamedayId, gamedayId) });
    if (assignments.length === 0) {
      throw ApiError.badRequest("Assign players to Team A / Team B before entering a result");
    }
    const hasA = assignments.some((a) => a.team === "A");
    const hasB = assignments.some((a) => a.team === "B");
    if (!hasA || !hasB) {
      throw ApiError.badRequest("Both Team A and Team B need at least one player");
    }

    const { teamAScore, teamBScore } = parsed.data;
    const teamAStat = computeTeamResult(teamAScore, teamBScore);
    const teamBStat = computeTeamResult(teamBScore, teamAScore);

    await db.transaction(async (tx) => {
      const existing = await tx.query.results.findFirst({ where: eq(results.gamedayId, gamedayId) });
      let resultId: number;
      if (existing) {
        const [updated] = await tx
          .update(results)
          .set({ teamAScore, teamBScore, enteredByUserId: req.user!.userId, updatedAt: new Date() })
          .where(eq(results.id, existing.id))
          .returning();
        resultId = updated.id;
        await tx.delete(playerGamedayStats).where(eq(playerGamedayStats.resultId, resultId));
      } else {
        const [created] = await tx
          .insert(results)
          .values({ gamedayId, teamAScore, teamBScore, enteredByUserId: req.user!.userId })
          .returning();
        resultId = created.id;
      }

      const statRows = assignments.map((a) => {
        const stat = a.team === "A" ? teamAStat : teamBStat;
        return { resultId, playerId: a.playerId, team: a.team, points: stat.points, goalDiff: stat.goalDiff };
      });
      await tx.insert(playerGamedayStats).values(statRows);

      await tx.update(gamedays).set({ status: "COMPLETED", updatedAt: new Date() }).where(eq(gamedays.id, gamedayId));
    });

    res.json({ message: "Result saved" });
  })
);

export default router;
