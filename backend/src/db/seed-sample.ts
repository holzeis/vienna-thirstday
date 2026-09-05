/**
 * Dev/demo-only sample data: a roster of players and several seasons' worth
 * of weekly gamedays with varied scores, plus a couple of upcoming open
 * gamedays with sign-ups. Lets the standings/hall-of-fame/achievements/player
 * profile features be exercised without waiting for real usage to build up.
 *
 * Idempotent (safe to re-run): players are matched by exact name, gamedays by
 * exact date. Refuses to run against a production environment.
 *
 * Usage: npm run seed:sample
 */
import "dotenv/config";
import { db, pool } from "./client";
import { gamedays, players, registrations, results, playerGamedayStats, users } from "./schema";
import { eq } from "drizzle-orm";
import { computeTeamResult } from "../utils/scoring";

const SAMPLE_PLAYERS = [
  "Lukas",
  "Max",
  "Paul",
  "Jonas",
  "Felix",
  "Tobias",
  "David",
  "Simon",
  "Michael",
  "Andi",
  "Chris",
  "Basti",
  "Flo",
  "Niki",
  "Robert",
  "Sebastian",
];

const STAR_PLAYER = "Lukas";
const NUM_PAST_GAMEDAYS = 140;
const SCORELINES: [number, number][] = [
  [5, 3],
  [4, 4],
  [6, 2],
  [3, 3],
  [7, 5],
  [2, 1],
  [4, 2],
  [3, 5],
  [5, 5],
  [6, 4],
];
// A deliberate consecutive run for the star player, to give the Hall of Fame
// win-streak category something to show.
const STAR_STREAK_RANGE: [number, number] = [40, 47];

// The current-form badges (Veteran/Undefeated/Unlucky) are judged against
// "today" - the league's most recent 5 completed gamedays - so a fixed
// historical streak can't demonstrate them. This window (i=0..4, the most
// recent gamedays generated below) is instead scripted to always feature
// three showcase players so each badge has a live example on fresh data.
const SHOWCASE_WINDOW = 5;
const SHOWCASE_VETERAN = "Lukas"; // attends all of the last 5 -> Veteran.
const SHOWCASE_UNDEFEATED = "Max"; // always on the winning side -> Undefeated.
const SHOWCASE_UNLUCKY = "Sebastian"; // always on the losing side -> Unlucky.
const SHOWCASE_SCORELINES: [number, number][] = [
  [5, 2],
  [4, 1],
  [6, 3],
  [3, 1],
  [5, 3],
];

function mostRecentThursdayBefore(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 18, 0, 0));
  const day = d.getUTCDay(); // 0=Sun..6=Sat, Thursday=4
  const diff = (day - 4 + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed sample data against a production environment (NODE_ENV=production).");
  }

  const admin = await db.query.users.findFirst({ where: eq(users.isAdmin, true) });
  if (!admin) {
    throw new Error("No admin user found. Run `npm run seed` first to bootstrap an admin account.");
  }

  const playerIdByName = new Map<string, number>();
  for (const name of SAMPLE_PLAYERS) {
    const existing = await db.query.players.findFirst({ where: eq(players.name, name) });
    if (existing) {
      playerIdByName.set(name, existing.id);
      continue;
    }
    const [created] = await db.insert(players).values({ name, isGuest: false }).returning();
    playerIdByName.set(name, created.id);
  }
  console.log(`Sample players ready: ${playerIdByName.size}`);

  const n = SAMPLE_PLAYERS.length;
  let createdGamedays = 0;
  let skippedGamedays = 0;
  const lastThursday = mostRecentThursdayBefore(new Date());

  let reconciledGamedays = 0;
  // Counts actual showcase gamedays produced (not iterations) - a real gameday
  // (e.g. imported legacy history) already sitting on one of the target weekly
  // dates is left untouched, and the showcase window simply reaches one week
  // further back instead, up to SHOWCASE_MAX_LOOKBACK as a safety valve. This
  // keeps the 3 showcase players' own last-5-played games showcase games even
  // when real history occupies a slot in between.
  let showcaseFilled = 0;
  const SHOWCASE_MAX_LOOKBACK = 20;

  for (let i = 0; i < NUM_PAST_GAMEDAYS; i++) {
    // Walking backwards from the most recent Thursday, one week at a time.
    const date = new Date(lastThursday);
    date.setUTCDate(date.getUTCDate() - 7 * i);

    const isShowcase = showcaseFilled < SHOWCASE_WINDOW && i < SHOWCASE_MAX_LOOKBACK;
    const existing = await db.query.gamedays.findFirst({ where: eq(gamedays.date, date) });
    if (existing) {
      if (isShowcase && existing.notes === "Sample data") {
        // The showcase window depends on "today"'s most recent gamedays,
        // so re-running the script after a fix must actually replace them
        // rather than skip them as already-seeded. Cascades take results/
        // playerGamedayStats with it.
        await db.delete(gamedays).where(eq(gamedays.id, existing.id));
        reconciledGamedays++;
      } else {
        // A non-sample (e.g. real imported) gameday already occupies this
        // week - leave it alone and don't count it against the showcase
        // window; the next iteration tries the next week back instead.
        skippedGamedays++;
        continue;
      }
    }

    let teamA: string[];
    let teamB: string[];
    let scoreA: number;
    let scoreB: number;

    if (isShowcase) {
      const others = SAMPLE_PLAYERS.filter((p) => p !== SHOWCASE_VETERAN && p !== SHOWCASE_UNDEFEATED && p !== SHOWCASE_UNLUCKY);
      const fillerCount = 7 + (showcaseFilled % 3); // 7-9 extra players alongside the 3 showcase players
      const fillerIndices: number[] = [];
      for (let k = 0; k < fillerCount; k++) fillerIndices.push((showcaseFilled * 2 + k) % others.length);
      const filler = Array.from(new Set(fillerIndices)).map((idx) => others[idx]);
      const fillerHalf = Math.ceil(filler.length / 2);

      teamA = [SHOWCASE_VETERAN, SHOWCASE_UNDEFEATED, ...filler.slice(0, fillerHalf)];
      teamB = [SHOWCASE_UNLUCKY, ...filler.slice(fillerHalf)];
      [scoreA, scoreB] = SHOWCASE_SCORELINES[showcaseFilled % SHOWCASE_SCORELINES.length];
      showcaseFilled++;
    } else {
      const attendeeCount = 10 + (i % 5); // 10-14 players
      const attendeeIndices: number[] = [];
      for (let k = 0; k < attendeeCount; k++) attendeeIndices.push((i * 3 + k) % n);
      const attendees = Array.from(new Set(attendeeIndices)).map((idx) => SAMPLE_PLAYERS[idx]);

      const starIndex = attendees.indexOf(STAR_PLAYER);
      // The star player attends the large majority of games (skip roughly 1 in 10).
      const includeStar = i % 10 !== 0;
      const roster = includeStar
        ? starIndex === -1
          ? [...attendees.slice(0, attendees.length - 1), STAR_PLAYER]
          : attendees
        : attendees.filter((p) => p !== STAR_PLAYER);

      const half = Math.ceil(roster.length / 2);
      teamA = roster.slice(0, half);
      teamB = roster.slice(half);

      const inStreak = i >= STAR_STREAK_RANGE[0] && i <= STAR_STREAK_RANGE[1];
      if (inStreak && !teamA.includes(STAR_PLAYER) && teamB.includes(STAR_PLAYER)) {
        // Force the star onto team A (the winning side below) during the streak window.
        teamB = teamB.filter((p) => p !== STAR_PLAYER);
        teamA = [...teamA, STAR_PLAYER];
      }

      [scoreA, scoreB] = SCORELINES[i % SCORELINES.length];
      if (inStreak && scoreA <= scoreB) [scoreA, scoreB] = [scoreB + 1, scoreA];
    }

    const teamAStat = computeTeamResult(scoreA, scoreB);
    const teamBStat = computeTeamResult(scoreB, scoreA);

    await db.transaction(async (tx) => {
      const [gameday] = await tx
        .insert(gamedays)
        .values({
          date,
          status: "COMPLETED",
          createdByUserId: admin.id,
          notes: "Sample data",
        })
        .returning();

      const [result] = await tx
        .insert(results)
        .values({ gamedayId: gameday.id, teamAScore: scoreA, teamBScore: scoreB, enteredByUserId: admin.id })
        .returning();

      const statRows = [
        ...teamA.map((name) => ({
          resultId: result.id,
          playerId: playerIdByName.get(name)!,
          team: "A" as const,
          points: teamAStat.points,
          goalDiff: teamAStat.goalDiff,
        })),
        ...teamB.map((name) => ({
          resultId: result.id,
          playerId: playerIdByName.get(name)!,
          team: "B" as const,
          points: teamBStat.points,
          goalDiff: teamBStat.goalDiff,
        })),
      ];
      await tx.insert(playerGamedayStats).values(statRows);
    });
    createdGamedays++;
  }

  console.log(
    `Past gamedays: created ${createdGamedays} (${reconciledGamedays} reconciled for the current-form showcase window), skipped ${skippedGamedays} (already present).`
  );

  // A couple of upcoming open gamedays with some sign-ups, to demo the sign-up flow.
  let createdUpcoming = 0;
  for (let w = 1; w <= 2; w++) {
    const date = new Date(lastThursday);
    date.setUTCDate(date.getUTCDate() + 7 * w);

    const existing = await db.query.gamedays.findFirst({ where: eq(gamedays.date, date) });
    if (existing) continue;

    await db.transaction(async (tx) => {
      const [gameday] = await tx
        .insert(gamedays)
        .values({ date, status: "OPEN", createdByUserId: admin.id, notes: "Sample data" })
        .returning();

      const signups = SAMPLE_PLAYERS.slice(0, 5 + w);
      await tx.insert(registrations).values(
        signups.map((name) => ({
          gamedayId: gameday.id,
          playerId: playerIdByName.get(name)!,
          status: "CONFIRMED" as const,
          registeredByUserId: admin.id,
        }))
      );
    });
    createdUpcoming++;
  }
  console.log(`Upcoming gamedays created: ${createdUpcoming}.`);
}

main()
  .catch((err) => {
    console.error("Sample seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
