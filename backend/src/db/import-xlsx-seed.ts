/**
 * One-time historical data import.
 *
 * Loads every `*-import.json` file in ./seed-data (one per season, each
 * produced by scripts/export_xlsx_to_json.py from that year's Kicken_<year>.xlsx
 * spreadsheet) and creates matching Players, Gamedays, Results and
 * PlayerGamedayStats so each imported season continues seamlessly inside the
 * app. A player appearing in multiple years' files is matched by exact name
 * and shares one player record across seasons - see
 * `resolvePlayerIdForName` for the one exception: a name that's since been
 * merged into a differently-named real account resolves to that account
 * instead of spawning a duplicate guest.
 *
 * Imported players are created as GUESTS, not real players. Nobody has an
 * account yet, so there's no user to "own" this history - and per the season
 * standings rule, guests don't appear in the ranking table. That's
 * intentional: until an admin invites one of them (promoting the guest in
 * place - see routes/invites.ts), their history stays parked on the
 * placeholder guest record and out of the live standings. Once claimed, the
 * real account inherits the guest's full history and appears in standings
 * normally.
 *
 * IMPORTANT CAVEAT: the legacy spreadsheet recorded each player's exact points
 * (4/2/1) and goal difference per matchday, and those are imported verbatim -
 * once a player's guest is claimed via an invite, their contribution to the
 * season standings matches the original spreadsheet's table exactly (you can
 * verify this by claiming everyone and comparing). What the spreadsheet never
 * recorded is the literal final score (e.g. "5:3") - only the differential -
 * or a kickoff time. This importer reconstructs a team A / team B split
 * (points==4 group vs points==1 group, also used to create real
 * teamAssignments rows) and a placeholder score with the right goal
 * difference purely for display; treat the reconstructed score for
 * historical gamedays as illustrative, not exact. The team split itself
 * *is* exact - it's the same points-based grouping the standings math
 * already relies on. Kickoff is set to 19:00 Europe/Vienna time (the
 * league's fixed slot), converted to UTC with the correct seasonal DST
 * offset - see utils/timezone.ts.
 *
 * Run `npm run seed` first (bootstraps an admin) before running this.
 *
 * Safe to re-run after regenerating the JSON - e.g. a fix to
 * scripts/export_xlsx_to_json.py's placeholder-score logic, a kickoff-time
 * fix here, or the spreadsheet itself being corrected (a wrong name
 * dropped, a typo fixed, a missed attendee added). An existing gameday is
 * matched by calendar date (not the exact timestamp, so a time-of-day
 * correction doesn't create a duplicate), and its date/score/registrations/
 * team-assignments/stats are reconciled in place rather than re-created -
 * see `diffRoster`/`diffStats` for exactly what "reconciled" covers.
 *
 * Usage:
 *   npm run seed:import-xlsx                       # imports every *-import.json in seed-data/
 *   npm run seed:import-xlsx -- kicken-2025-import.json   # imports just that one file
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { db, pool } from "./client";
import { gamedays, players, playerMerges, results, playerGamedayStats, registrations, teamAssignments, users } from "./schema";
import { and, desc, eq, gte, inArray, isNull, like, lt } from "drizzle-orm";
import { zonedTimeToUtc } from "../utils/timezone";

const KICKOFF_HOUR = 19;
const LEAGUE_TIMEZONE = "Europe/Vienna";
const IMPORT_NOTE_PREFIX = "Imported from legacy spreadsheet";

interface ImportEntry {
  name: string;
  points: number;
  goalDiff: number;
}

interface ImportGameday {
  spieltag: number;
  date: string;
  teamA: ImportEntry[];
  teamB: ImportEntry[];
  placeholderScoreA: number;
  placeholderScoreB: number;
}

interface ImportFile {
  players: string[];
  gamedays: ImportGameday[];
}

/**
 * Resolves a spreadsheet player name to a live player id, honoring a prior
 * guest-into-player merge under that exact name - without this, re-running
 * (or first running a new year's) import for a guest who has since been
 * merged into a differently-named real account would silently create a
 * *second*, duplicate guest under the old name instead of attaching that
 * year's history to the account it was already merged into (confirmed to
 * happen live: "Richi" merged into "Richie" reappeared as a fresh guest on
 * a later import). Falls back to null (caller creates a new guest) only
 * when neither a live player nor a past merge log entry matches - most
 * names never having been merged at all.
 */
async function resolvePlayerIdForName(name: string): Promise<number | null> {
  const existing = await db.query.players.findFirst({ where: eq(players.name, name) });
  if (existing) return existing.id;

  // Most-recent non-undone merge wins, in case the name was merged more
  // than once over the years (e.g. re-created as a guest and merged again
  // after an earlier merge was undone).
  const merge = await db.query.playerMerges.findFirst({
    where: and(eq(playerMerges.guestPlayerName, name), isNull(playerMerges.undoneAt)),
    orderBy: [desc(playerMerges.createdAt)],
  });
  if (!merge) return null;

  const target = await db.query.players.findFirst({ where: eq(players.id, merge.targetPlayerId) });
  return target?.id ?? null;
}

/**
 * Which of `rosterIds` (this gameday's current roster, by player id) are
 * missing from `existingRows`, and which existing rows belong to a player
 * the roster no longer includes - shared by the registrations and team-
 * assignments reconcile passes below. A player can be "missing" (added to
 * the spreadsheet since the last import) and another can be "stale" (a
 * name correction dropped them) in the same reconcile pass.
 */
function diffRoster(existingRows: { id: number; playerId: number }[], rosterIds: number[]): { missingPlayerIds: number[]; staleRowIds: number[] } {
  const rosterSet = new Set(rosterIds);
  const existingPlayerIds = new Set(existingRows.map((r) => r.playerId));
  return {
    missingPlayerIds: rosterIds.filter((id) => !existingPlayerIds.has(id)),
    staleRowIds: existingRows.filter((r) => !rosterSet.has(r.playerId)).map((r) => r.id),
  };
}

interface StatEntry {
  playerId: number;
  team: "A" | "B";
  points: number;
  goalDiff: number;
}

/**
 * Which gameday-stat rows to add, correct in place, or drop to bring an
 * already-imported gameday's stats in line with a corrected spreadsheet -
 * added for someone new to the roster, corrected for someone whose
 * recorded team/points/goal-diff changed, dropped for someone the roster
 * no longer includes. Without this, a spreadsheet correction to an
 * already-imported gameday (a wrong name dropped, a typo fixed, a missed
 * attendee added) would leave the old data behind - a renamed or newly-
 * added player would show up on the roster but never actually score, and a
 * dropped one would keep silently counting.
 */
function diffStats(
  existingStats: { id: number; playerId: number; team: "A" | "B"; points: number; goalDiff: number }[],
  entries: StatEntry[]
): { toAdd: StatEntry[]; toUpdate: (StatEntry & { id: number })[]; staleRowIds: number[] } {
  const existingByPlayer = new Map(existingStats.map((s) => [s.playerId, s]));
  const entryPlayerIds = new Set(entries.map((e) => e.playerId));

  const toAdd: StatEntry[] = [];
  const toUpdate: (StatEntry & { id: number })[] = [];
  for (const e of entries) {
    const existing = existingByPlayer.get(e.playerId);
    if (!existing) {
      toAdd.push(e);
    } else if (existing.team !== e.team || existing.points !== e.points || existing.goalDiff !== e.goalDiff) {
      toUpdate.push({ id: existing.id, ...e });
    }
  }
  const staleRowIds = existingStats.filter((s) => !entryPlayerIds.has(s.playerId)).map((s) => s.id);

  return { toAdd, toUpdate, staleRowIds };
}

async function importFile(filePath: string, admin: { id: number }) {
  const data: ImportFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  console.log(`\n=== ${path.basename(filePath)}: ${data.players.length} players, ${data.gamedays.length} gamedays ===`);

  const playerIdByName = new Map<string, number>();
  for (const name of data.players) {
    const resolvedId = await resolvePlayerIdForName(name);
    if (resolvedId !== null) {
      playerIdByName.set(name, resolvedId);
      continue;
    }
    const [created] = await db.insert(players).values({ name, isGuest: true }).returning();
    playerIdByName.set(name, created.id);
  }
  console.log(`Players ready: ${playerIdByName.size}`);

  let created = 0;
  let reconciled = 0;
  for (const gd of data.gamedays) {
    const date = zonedTimeToUtc(gd.date, KICKOFF_HOUR, 0, LEAGUE_TIMEZONE);
    const dayStart = new Date(`${gd.date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const teamAIds = gd.teamA.map((e) => playerIdByName.get(e.name)).filter((id): id is number => id !== undefined);
    const teamBIds = gd.teamB.map((e) => playerIdByName.get(e.name)).filter((id): id is number => id !== undefined);
    const roster = [...teamAIds, ...teamBIds];

    // Matched by calendar date, not the exact timestamp - so a future
    // kickoff-time correction reconciles the existing row instead of being
    // mistaken for a new gameday and duplicated. Scoped to previously
    // imported rows so this can never collide with an unrelated gameday
    // someone created by hand on the same date.
    const existingGameday = await db.query.gamedays.findFirst({
      where: and(gte(gamedays.date, dayStart), lt(gamedays.date, dayEnd), like(gamedays.notes, `${IMPORT_NOTE_PREFIX}%`)),
    });
    if (existingGameday) {
      let touched = false;

      if (existingGameday.date.getTime() !== date.getTime()) {
        await db.update(gamedays).set({ date, updatedAt: new Date() }).where(eq(gamedays.id, existingGameday.id));
        touched = true;
      }

      const existingResult = await db.query.results.findFirst({ where: eq(results.gamedayId, existingGameday.id) });
      if (
        existingResult &&
        (existingResult.teamAScore !== gd.placeholderScoreA || existingResult.teamBScore !== gd.placeholderScoreB)
      ) {
        await db
          .update(results)
          .set({ teamAScore: gd.placeholderScoreA, teamBScore: gd.placeholderScoreB, updatedAt: new Date() })
          .where(eq(results.id, existingResult.id));
        touched = true;
      }

      const existingRegs = await db.query.registrations.findMany({ where: eq(registrations.gamedayId, existingGameday.id) });
      const regDiff = diffRoster(existingRegs, roster);
      if (regDiff.missingPlayerIds.length > 0) {
        await db.insert(registrations).values(
          regDiff.missingPlayerIds.map((playerId) => ({ gamedayId: existingGameday.id, playerId, status: "CONFIRMED" as const, registeredByUserId: admin.id }))
        );
        touched = true;
      }
      if (regDiff.staleRowIds.length > 0) {
        await db.delete(registrations).where(inArray(registrations.id, regDiff.staleRowIds));
        touched = true;
      }

      const existingAssignments = await db.query.teamAssignments.findMany({ where: eq(teamAssignments.gamedayId, existingGameday.id) });
      const assignmentDiff = diffRoster(existingAssignments, roster);
      const missingAssignments = [
        ...teamAIds.filter((id) => assignmentDiff.missingPlayerIds.includes(id)).map((playerId) => ({ gamedayId: existingGameday.id, playerId, team: "A" as const })),
        ...teamBIds.filter((id) => assignmentDiff.missingPlayerIds.includes(id)).map((playerId) => ({ gamedayId: existingGameday.id, playerId, team: "B" as const })),
      ];
      if (missingAssignments.length > 0) {
        await db.insert(teamAssignments).values(missingAssignments);
        touched = true;
      }
      if (assignmentDiff.staleRowIds.length > 0) {
        await db.delete(teamAssignments).where(inArray(teamAssignments.id, assignmentDiff.staleRowIds));
        touched = true;
      }

      if (existingResult) {
        const existingStats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.resultId, existingResult.id) });
        const entries: StatEntry[] = [
          ...gd.teamA.map((e) => ({ playerId: playerIdByName.get(e.name), team: "A" as const, points: e.points, goalDiff: e.goalDiff })),
          ...gd.teamB.map((e) => ({ playerId: playerIdByName.get(e.name), team: "B" as const, points: e.points, goalDiff: e.goalDiff })),
        ].filter((e): e is StatEntry => e.playerId !== undefined);
        const statDiff = diffStats(existingStats, entries);

        if (statDiff.toAdd.length > 0) {
          await db.insert(playerGamedayStats).values(statDiff.toAdd.map((e) => ({ resultId: existingResult.id, ...e })));
          touched = true;
        }
        for (const u of statDiff.toUpdate) {
          await db.update(playerGamedayStats).set({ team: u.team, points: u.points, goalDiff: u.goalDiff }).where(eq(playerGamedayStats.id, u.id));
          touched = true;
        }
        if (statDiff.staleRowIds.length > 0) {
          await db.delete(playerGamedayStats).where(inArray(playerGamedayStats.id, statDiff.staleRowIds));
          touched = true;
        }
      }

      if (touched) reconciled++;
      continue;
    }

    await db.transaction(async (tx) => {
      const [gameday] = await tx
        .insert(gamedays)
        .values({
          date,
          status: "COMPLETED",
          createdByUserId: admin.id,
          notes: `${IMPORT_NOTE_PREFIX} (Spieltag ${gd.spieltag}). Team split and score are best-effort reconstructions; points/goal-diff are exact.`,
        })
        .returning();

      const [result] = await tx
        .insert(results)
        .values({
          gamedayId: gameday.id,
          teamAScore: gd.placeholderScoreA,
          teamBScore: gd.placeholderScoreB,
          enteredByUserId: admin.id,
        })
        .returning();

      const statRows = [
        ...gd.teamA.map((e) => ({
          resultId: result.id,
          playerId: playerIdByName.get(e.name),
          team: "A" as const,
          points: e.points,
          goalDiff: e.goalDiff,
        })),
        ...gd.teamB.map((e) => ({
          resultId: result.id,
          playerId: playerIdByName.get(e.name),
          team: "B" as const,
          points: e.points,
          goalDiff: e.goalDiff,
        })),
      ].filter((r): r is typeof r & { playerId: number } => r.playerId !== undefined);

      if (statRows.length > 0) {
        await tx.insert(playerGamedayStats).values(statRows);
      }

      // The actual player count for an imported gameday should reflect who
      // really played, not the default max-players capacity - registering
      // everyone who has a stat row for this gameday makes the "confirmed"
      // count derive correctly with no special-casing elsewhere.
      if (roster.length > 0) {
        await tx.insert(registrations).values(
          roster.map((playerId) => ({
            gamedayId: gameday.id,
            playerId,
            status: "CONFIRMED" as const,
            registeredByUserId: admin.id,
          }))
        );
      }

      // The team split is already known exactly (it's the same points-based
      // grouping the score reconstruction above relies on), so there's no
      // reason to leave an admin to re-assign everyone by hand later.
      const assignmentRows = [
        ...teamAIds.map((playerId) => ({ gamedayId: gameday.id, playerId, team: "A" as const })),
        ...teamBIds.map((playerId) => ({ gamedayId: gameday.id, playerId, team: "B" as const })),
      ];
      if (assignmentRows.length > 0) {
        await tx.insert(teamAssignments).values(assignmentRows);
      }
    });
    created++;
  }

  console.log(
    `Imported ${created} new gamedays, reconciled ${reconciled} existing one(s) (${
      data.gamedays.length - created - reconciled
    } already up to date).`
  );
}

async function main() {
  const seedDataDir = path.join(__dirname, "seed-data");
  const arg = process.argv[2];
  const files = arg
    ? [path.join(seedDataDir, arg)]
    : fs
        .readdirSync(seedDataDir)
        .filter((f) => f.endsWith("-import.json"))
        .sort()
        .map((f) => path.join(seedDataDir, f));

  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    throw new Error(`Import file(s) not found: ${missing.join(", ")}. Run scripts/export_xlsx_to_json.py first.`);
  }
  if (files.length === 0) {
    throw new Error(`No *-import.json files found in ${seedDataDir}. Run scripts/export_xlsx_to_json.py first.`);
  }

  const admin = await db.query.users.findFirst({ where: eq(users.isAdmin, true) });
  if (!admin) {
    throw new Error("No admin user found. Run `npm run seed` first to bootstrap an admin account.");
  }

  for (const filePath of files) {
    await importFile(filePath, admin);
  }
}

// Guarded so this file can be imported (e.g. by a test exercising
// resolvePlayerIdForName) without immediately running the whole import.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Import failed:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

export { resolvePlayerIdForName, diffRoster, diffStats };
