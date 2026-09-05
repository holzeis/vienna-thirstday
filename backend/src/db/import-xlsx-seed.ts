/**
 * One-time historical data import.
 *
 * Loads every `*-import.json` file in ./seed-data (one per season, each
 * produced by scripts/export_xlsx_to_json.py from that year's Kicken_<year>.xlsx
 * spreadsheet) and creates matching Players, Gamedays, Results and
 * PlayerGamedayStats so each imported season continues seamlessly inside the
 * app. A player appearing in multiple years' files is matched by exact name
 * and shares one player record across seasons.
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
 * Safe to re-run after regenerating the JSON (e.g. after a fix to
 * scripts/export_xlsx_to_json.py's placeholder-score logic, or a kickoff-time
 * fix here): an existing gameday is matched by calendar date (not the exact
 * timestamp, so a time-of-day correction doesn't create a duplicate) and its
 * date/score/registrations/team assignments are reconciled in place rather
 * than re-created.
 *
 * Usage:
 *   npm run seed:import-xlsx                       # imports every *-import.json in seed-data/
 *   npm run seed:import-xlsx -- kicken-2025-import.json   # imports just that one file
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { db, pool } from "./client";
import { gamedays, players, results, playerGamedayStats, registrations, teamAssignments, users } from "./schema";
import { and, eq, gte, like, lt } from "drizzle-orm";
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

async function importFile(filePath: string, admin: { id: number }) {
  const data: ImportFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  console.log(`\n=== ${path.basename(filePath)}: ${data.players.length} players, ${data.gamedays.length} gamedays ===`);

  const playerIdByName = new Map<string, number>();
  for (const name of data.players) {
    const existing = await db.query.players.findFirst({ where: eq(players.name, name) });
    if (existing) {
      playerIdByName.set(name, existing.id);
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
      const alreadyRegistered = new Set(existingRegs.map((r) => r.playerId));
      const missingRegs = roster
        .filter((playerId) => !alreadyRegistered.has(playerId))
        .map((playerId) => ({ gamedayId: existingGameday.id, playerId, status: "CONFIRMED" as const, registeredByUserId: admin.id }));
      if (missingRegs.length > 0) {
        await db.insert(registrations).values(missingRegs);
        touched = true;
      }

      const existingAssignments = await db.query.teamAssignments.findMany({ where: eq(teamAssignments.gamedayId, existingGameday.id) });
      const alreadyAssigned = new Set(existingAssignments.map((a) => a.playerId));
      const missingAssignments = [
        ...teamAIds.filter((id) => !alreadyAssigned.has(id)).map((playerId) => ({ gamedayId: existingGameday.id, playerId, team: "A" as const })),
        ...teamBIds.filter((id) => !alreadyAssigned.has(id)).map((playerId) => ({ gamedayId: existingGameday.id, playerId, team: "B" as const })),
      ];
      if (missingAssignments.length > 0) {
        await db.insert(teamAssignments).values(missingAssignments);
        touched = true;
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

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
