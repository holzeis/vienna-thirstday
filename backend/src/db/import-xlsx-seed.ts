/**
 * One-time historical data import.
 *
 * Loads ./seed-data/kicken-2026-import.json (produced by
 * scripts/export_xlsx_to_json.py from the legacy Kicken_2026.xlsx spreadsheet)
 * and creates matching Players, Gamedays, Results and PlayerGamedayStats so
 * the 2026 season continues seamlessly inside the app.
 *
 * Imported players are created as GUESTS, not real players. Nobody has an
 * account yet, so there's no user to "own" this history - and per the season
 * standings rule, guests don't appear in the ranking table. That's
 * intentional: until an admin merges an imported player into a real
 * registered account (see the "merge with existing player" option when
 * approving a pending user, `mergeGuestIntoPlayer` in
 * src/services/playerMergeService.ts), their history stays parked on the
 * placeholder guest record and out of the live standings. Once merged, the
 * real account inherits the guest's full history and appears in standings
 * normally.
 *
 * IMPORTANT CAVEAT: the legacy spreadsheet recorded each player's exact points
 * (4/2/1) and goal difference per matchday, and those are imported verbatim -
 * once a player is merged into a real account, their contribution to the
 * season standings matches the original spreadsheet's table exactly (you can
 * verify this by merging everyone and comparing). What the spreadsheet never
 * recorded is the two teams' rosters as a first-class concept, or the literal
 * final score (e.g. "5:3") - only the differential. This importer
 * reconstructs a team A / team B split (points==4 group vs points==1 group)
 * and a placeholder score with the right goal difference purely for display;
 * treat the reconstructed score and team split for historical gamedays as
 * illustrative, not exact.
 *
 * Run `npm run seed` first (bootstraps an admin) before running this.
 *
 * Safe to re-run after regenerating the JSON (e.g. after a fix to
 * scripts/export_xlsx_to_json.py's placeholder-score logic): gamedays that
 * already exist are not duplicated, but their `results` row is reconciled to
 * the (possibly corrected) placeholder score if it changed.
 *
 * Usage: npm run seed:import-xlsx
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { db, pool } from "./client";
import { gamedays, players, results, playerGamedayStats, users } from "./schema";
import { eq } from "drizzle-orm";

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

async function main() {
  const filePath = path.join(__dirname, "seed-data", "kicken-2026-import.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`Import file not found at ${filePath}. Run scripts/export_xlsx_to_json.py first.`);
  }
  const data: ImportFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const admin = await db.query.users.findFirst({ where: eq(users.isAdmin, true) });
  if (!admin) {
    throw new Error("No admin user found. Run `npm run seed` first to bootstrap an admin account.");
  }

  console.log(`Importing ${data.players.length} players and ${data.gamedays.length} gamedays...`);

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
    const date = new Date(`${gd.date}T18:00:00.000Z`);

    // Skip creating a duplicate on re-runs, but still reconcile the score if
    // this gameday was imported before the placeholder-score bug was fixed.
    const existingGameday = await db.query.gamedays.findFirst({ where: eq(gamedays.date, date) });
    if (existingGameday) {
      const existingResult = await db.query.results.findFirst({ where: eq(results.gamedayId, existingGameday.id) });
      if (
        existingResult &&
        (existingResult.teamAScore !== gd.placeholderScoreA || existingResult.teamBScore !== gd.placeholderScoreB)
      ) {
        await db
          .update(results)
          .set({ teamAScore: gd.placeholderScoreA, teamBScore: gd.placeholderScoreB, updatedAt: new Date() })
          .where(eq(results.id, existingResult.id));
        reconciled++;
      }
      continue;
    }

    await db.transaction(async (tx) => {
      const [gameday] = await tx
        .insert(gamedays)
        .values({
          date,
          status: "COMPLETED",
          createdByUserId: admin.id,
          notes: `Imported from legacy spreadsheet (Spieltag ${gd.spieltag}). Team split and score are best-effort reconstructions; points/goal-diff are exact.`,
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
    });
    created++;
  }

  console.log(
    `Imported ${created} new gamedays, reconciled ${reconciled} existing score(s) (${
      data.gamedays.length - created - reconciled
    } already up to date).`
  );
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
