/**
 * Shared per-player aggregation logic used by the player profile, Hall of
 * Fame, and achievements features. Everything here is computed fresh from
 * playerGamedayStats/results/gamedays/players on every call rather than
 * stored - playerMergeService reassigns historical rows to a different
 * playerId after the fact when a guest is merged into a real account, so any
 * stored/cached aggregate would silently go stale with no invalidation hook.
 * Fine performance-wise at this dataset size (a hobby league).
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { ACHIEVEMENT_THRESHOLDS, tierForValue, type AchievementCategory, type AchievementTier } from "../utils/achievementThresholds";

export type { AchievementCategory, AchievementTier };

export interface StatRow {
  playerId: number;
  playerName: string;
  isGuest: boolean;
  gamedayId: number;
  date: Date;
  team: "A" | "B";
  points: number;
  goalDiff: number;
  teamScore: number;
}

export interface CareerStats {
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalDiff: number;
  goals: number;
}

export interface TeammateRecord {
  playerId: number;
  name: string;
  sharedGames: number;
  sharedWins: number;
  sharedLosses: number;
  /** Populated by the route layer (this service has no DB access) - null until enriched. */
  avatarDataUri: string | null;
}

/** Lifetime, lifelong-progression categories - lifetime count vs a fixed bar. */
export type PersonalAwardCategory = AchievementCategory;
/** Per-completed-season, competitive categories - ranked 1st/2nd/3rd within that season. */
export type SeasonAwardCategory = "ranking" | "mostGames" | "mostGoals" | "longestWinStreak" | "longestLossStreak";
export type AwardCategory = PersonalAwardCategory | SeasonAwardCategory;

/**
 * Competitive (season) awards and the isAdmin badge are always exactly
 * gold/silver/bronze - if not earned, simply absent. The lifetime stat
 * categories (games/wins/draws/losses/points/goals) always render instead,
 * using "wood" as the below-bronze rung so the real value stays visible.
 */
export type AwardTier = "gold" | "silver" | "bronze" | "wood";

export interface PlayerAward {
  category: AwardCategory;
  tier: AwardTier;
  kind: "personal" | "season";
  season?: number;
  value: number;
}

export interface PodiumEntry {
  playerId: number;
  name: string;
  isGuest: boolean;
  value: number;
}

/** There is always at most one winner per medal - ties are resolved by secondary factors, never displayed as a tie. */
export interface PodiumAward {
  gold: PodiumEntry | null;
  silver: PodiumEntry | null;
  bronze: PodiumEntry | null;
}

const EMPTY_PODIUM: PodiumAward = { gold: null, silver: null, bronze: null };

type DbOrTx = NodePgDatabase<typeof schema>;

/** Fetches the flat, date-ordered stat rows everything else aggregates over. */
export async function fetchStatRows(db: DbOrTx, opts: { year?: number } = {}): Promise<StatRow[]> {
  const conditions = [];
  if (opts.year !== undefined) {
    const seasonStart = new Date(Date.UTC(opts.year, 0, 1));
    const seasonEnd = new Date(Date.UTC(opts.year + 1, 0, 1));
    conditions.push(gte(schema.gamedays.date, seasonStart), lt(schema.gamedays.date, seasonEnd));
  }

  const rows = await db
    .select({
      playerId: schema.players.id,
      playerName: schema.players.name,
      isGuest: schema.players.isGuest,
      gamedayId: schema.gamedays.id,
      date: schema.gamedays.date,
      team: schema.playerGamedayStats.team,
      points: schema.playerGamedayStats.points,
      goalDiff: schema.playerGamedayStats.goalDiff,
      teamScore: sql<number>`case when ${schema.playerGamedayStats.team} = 'A' then ${schema.results.teamAScore} else ${schema.results.teamBScore} end`.mapWith(
        Number
      ),
    })
    .from(schema.playerGamedayStats)
    .innerJoin(schema.results, eq(schema.playerGamedayStats.resultId, schema.results.id))
    .innerJoin(schema.gamedays, eq(schema.results.gamedayId, schema.gamedays.id))
    .innerJoin(schema.players, eq(schema.playerGamedayStats.playerId, schema.players.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(schema.gamedays.date);

  return rows as StatRow[];
}

export function computeCareerStats(rows: StatRow[]): CareerStats {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let points = 0;
  let goalDiff = 0;
  let goals = 0;
  for (const r of rows) {
    if (r.points === 4) wins++;
    else if (r.points === 2) draws++;
    else losses++;
    points += r.points;
    goalDiff += r.goalDiff;
    goals += r.teamScore;
  }
  return { gamesPlayed: rows.length, wins, draws, losses, points, goalDiff, goals };
}

/** Rows must belong to a single player and be date-ascending. */
export function computeStreaks(rows: StatRow[]): { longestWinStreak: number; longestLossStreak: number } {
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  for (const r of rows) {
    if (r.points === 4) {
      currentWinStreak++;
      currentLossStreak = 0;
    } else if (r.points === 1) {
      currentLossStreak++;
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
    longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
  }
  return { longestWinStreak, longestLossStreak };
}

const TEAMMATE_TALLY_THRESHOLD = 3;

/**
 * Tallies shared wins/losses between `playerId` and every other player
 * they've shared a team with. `favorite` (Lucky Charm) and `unfavorite`
 * (Jinx) only surface once a teammate has hit `TEAMMATE_TALLY_THRESHOLD`
 * shared wins/losses (same "at least 3 of the last 5" bar as `computeNemesis`)
 * - `mostPlayedWith` has no such threshold, any shared game counts.
 */
export function computeTeammateTally(
  allRows: StatRow[],
  playerId: number
): { favorite: TeammateRecord | null; unfavorite: TeammateRecord | null; mostPlayedWith: TeammateRecord | null } {
  const groups = new Map<string, StatRow[]>();
  for (const r of allRows) {
    const key = `${r.gamedayId}:${r.team}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const tally = new Map<number, TeammateRecord>();
  for (const group of groups.values()) {
    const mine = group.find((r) => r.playerId === playerId);
    if (!mine) continue;
    for (const other of group) {
      if (other.playerId === playerId) continue;
      let rec = tally.get(other.playerId);
      if (!rec) {
        rec = {
          playerId: other.playerId,
          name: other.playerName,
          sharedGames: 0,
          sharedWins: 0,
          sharedLosses: 0,
          avatarDataUri: null,
        };
        tally.set(other.playerId, rec);
      }
      rec.sharedGames++;
      if (mine.points === 4) rec.sharedWins++;
      else if (mine.points === 1) rec.sharedLosses++;
    }
  }

  const all = Array.from(tally.values());
  const favorite = all
    .filter((r) => r.sharedWins >= TEAMMATE_TALLY_THRESHOLD)
    .sort((a, b) => b.sharedWins - a.sharedWins || b.sharedGames - a.sharedGames)[0];
  const unfavorite = all
    .filter((r) => r.sharedLosses >= TEAMMATE_TALLY_THRESHOLD)
    .sort((a, b) => b.sharedLosses - a.sharedLosses || b.sharedGames - a.sharedGames)[0];
  const mostPlayedWith = all
    .filter((r) => r.sharedGames > 0)
    .sort((a, b) => b.sharedGames - a.sharedGames || b.sharedWins - a.sharedWins)[0];

  return { favorite: favorite ?? null, unfavorite: unfavorite ?? null, mostPlayedWith: mostPlayedWith ?? null };
}

export interface OpponentRecord {
  playerId: number;
  name: string;
  gamesAgainst: number;
  lossesAgainst: number;
  /** Populated by the route layer (this service has no DB access) - null until enriched. */
  avatarDataUri: string | null;
}

const NEMESIS_LOSS_THRESHOLD = 3;

/**
 * The opponent this player has struggled against most within `rows`
 * (expected to already be scoped to the player's own last 5 games, same
 * window as the teammate tally) - null unless they've lost to that specific
 * opponent at least `NEMESIS_LOSS_THRESHOLD` times in that window. Ties
 * broken by games faced, then name, for a single deterministic nemesis.
 */
export function computeNemesis(rows: StatRow[], playerId: number): OpponentRecord | null {
  const groups = new Map<number, StatRow[]>();
  for (const r of rows) {
    const list = groups.get(r.gamedayId);
    if (list) list.push(r);
    else groups.set(r.gamedayId, [r]);
  }

  const tally = new Map<number, OpponentRecord>();
  for (const group of groups.values()) {
    const mine = group.find((r) => r.playerId === playerId);
    if (!mine) continue;
    for (const other of group) {
      if (other.playerId === playerId || other.team === mine.team) continue;
      let rec = tally.get(other.playerId);
      if (!rec) {
        rec = { playerId: other.playerId, name: other.playerName, gamesAgainst: 0, lossesAgainst: 0, avatarDataUri: null };
        tally.set(other.playerId, rec);
      }
      rec.gamesAgainst++;
      if (mine.points === 1) rec.lossesAgainst++;
    }
  }

  const nemesis = Array.from(tally.values())
    .filter((r) => r.lossesAgainst >= NEMESIS_LOSS_THRESHOLD)
    .sort((a, b) => b.lossesAgainst - a.lossesAgainst || b.gamesAgainst - a.gamesAgainst || a.name.localeCompare(b.name))[0];

  return nemesis ?? null;
}

export interface CurrentForm {
  veteran: boolean;
  undefeated: boolean;
  unlucky: boolean;
  ghost: boolean;
}

/**
 * The ids of the league's last 5 completed gamedays (by date), across all
 * players - the one shared "recent" window for every Locker Room tile
 * (current-form badges, teammate chemistry). Deliberately never a specific
 * player's own last 5 played games, which could reach arbitrarily far back
 * for someone who plays sporadically - using one shared window keeps badges
 * like ghost/undefeated mutually consistent, and keeps "Partner in Crime" /
 * "Lucky Charm" / "Jinx" / "Nemesis" reflecting the actual last 5 gamedays
 * rather than some other stretch of this player's history.
 */
export function recentLeagueGamedayIds(allRows: StatRow[]): number[] {
  const gamedayDates = new Map<number, number>();
  for (const r of allRows) {
    if (!gamedayDates.has(r.gamedayId)) gamedayDates.set(r.gamedayId, r.date.getTime());
  }
  return Array.from(gamedayDates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);
}

/**
 * Transient current-form badges - unlike awards these can be lost the
 * moment the next gameday changes the picture, so they're recomputed fresh
 * every time rather than accumulated. `allRows` is unfiltered (all players,
 * all time) so the league's most recent gamedays can be found regardless of
 * whether this player was in all of them.
 *
 * All four badges judge the exact same window - the league's last 5
 * completed gamedays - never a player's own last 5 played games, which
 * could reach arbitrarily far back for someone who plays sporadically.
 * That's deliberate: it keeps veteran/ghost/undefeated/unlucky mutually
 * consistent (e.g. ghost and undefeated can never both be true - ghost
 * needs 0 appearances in that window, undefeated needs all 5).
 *  - veteran: played in every one of those 5 gamedays.
 *  - ghost: the exact opposite - played in none of them (including someone
 *    who's never played at all).
 *  - undefeated / unlucky: played all 5 (i.e. veteran), and every one of
 *    those 5 results was a win-or-draw / a loss.
 */
export function computeCurrentForm(allRows: StatRow[], playerId: number): CurrentForm {
  const recentGamedayIds = recentLeagueGamedayIds(allRows);

  const myRecentRows = allRows.filter((r) => r.playerId === playerId && recentGamedayIds.includes(r.gamedayId));
  const veteran = recentGamedayIds.length === 5 && myRecentRows.length === 5;
  const ghost = recentGamedayIds.length === 5 && myRecentRows.length === 0;
  const undefeated = veteran && myRecentRows.every((r) => r.points !== 1);
  const unlucky = veteran && myRecentRows.every((r) => r.points === 1);

  return { veteran, undefeated, unlucky, ghost };
}

export type Momentum = number | "new";

/**
 * Rank movement since the "before" snapshot (e.g. standings as they stood
 * immediately before the most recent gameday): positive = climbed that many
 * places, negative = dropped, 0 = unchanged, "new" = no prior rank to
 * compare against (a season debut).
 */
export function computeMomentum(beforeRank: number | undefined, currentRank: number): Momentum {
  return beforeRank === undefined ? "new" : beforeRank - currentRank;
}

/**
 * Chains comparators left to right, falling through to the next only when
 * the previous one calls it a tie (returns 0) - the standard way to build a
 * multi-factor sort with a guaranteed-deterministic final tiebreaker.
 */
function compareChain<T>(...fns: ((a: T, b: T) => number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const fn of fns) {
      const r = fn(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

/**
 * Ranks `perPlayer` by `compareFn` (best first, ties already broken by
 * secondary factors baked into the chain) and awards the top 3 gold/silver/
 * bronze - always at most one player per medal. Anyone with a non-positive
 * value is excluded so an early, barely-played season doesn't hand out
 * medals for "0".
 */
function podiumFor<T>(perPlayer: T[], compareFn: (a: T, b: T) => number, toEntry: (item: T) => PodiumEntry): PodiumAward {
  const eligible = perPlayer.filter((p) => toEntry(p).value > 0);
  const sorted = [...eligible].sort(compareFn);
  const [gold, silver, bronze] = sorted.slice(0, 3).map(toEntry);
  return { gold: gold ?? null, silver: silver ?? null, bronze: bronze ?? null };
}

/**
 * Podiums (1st/2nd/3rd -> gold/silver/bronze, always exactly one player per
 * medal) for one completed season's worth of `rows`. Every category's
 * primary metric is broken by the same secondary chain when tied - overall
 * season points, then goal-difference, then name - so there's never a
 * genuine draw. `ranking` mirrors the leaderboard's own rule (points desc,
 * then goal-diff desc) and needs its own tertiary factors (wins, then fewer
 * games played) since points/goal-diff are already its primary criteria.
 * `rows` should already be restricted to a single calendar year - guests are
 * eligible for these awards just like registered players.
 */
export function computeSeasonPodiums(rows: StatRow[]): Record<SeasonAwardCategory, PodiumAward> {
  const byPlayer = new Map<number, StatRow[]>();
  for (const r of rows) {
    const list = byPlayer.get(r.playerId);
    if (list) list.push(r);
    else byPlayer.set(r.playerId, [r]);
  }

  const perPlayer = Array.from(byPlayer.entries()).map(([playerId, playerRows]) => ({
    playerId,
    name: playerRows[0].playerName,
    isGuest: playerRows[0].isGuest,
    career: computeCareerStats(playerRows),
    streaks: computeStreaks(playerRows),
  }));
  type Player = (typeof perPlayer)[number];

  const byPoints = (a: Player, b: Player) => b.career.points - a.career.points;
  const byGoalDiff = (a: Player, b: Player) => b.career.goalDiff - a.career.goalDiff;
  const byWins = (a: Player, b: Player) => b.career.wins - a.career.wins;
  const byFewerGames = (a: Player, b: Player) => a.career.gamesPlayed - b.career.gamesPlayed;
  const byName = (a: Player, b: Player) => a.name.localeCompare(b.name);

  return {
    ranking: podiumFor<Player>(
      perPlayer,
      compareChain(byPoints, byGoalDiff, byWins, byFewerGames, byName),
      (p) => ({ playerId: p.playerId, name: p.name, isGuest: p.isGuest, value: p.career.points })
    ),
    mostGames: podiumFor<Player>(
      perPlayer,
      compareChain((a, b) => b.career.gamesPlayed - a.career.gamesPlayed, byPoints, byGoalDiff, byName),
      (p) => ({ playerId: p.playerId, name: p.name, isGuest: p.isGuest, value: p.career.gamesPlayed })
    ),
    mostGoals: podiumFor<Player>(
      perPlayer,
      compareChain((a, b) => b.career.goals - a.career.goals, byPoints, byGoalDiff, byName),
      (p) => ({ playerId: p.playerId, name: p.name, isGuest: p.isGuest, value: p.career.goals })
    ),
    longestWinStreak: podiumFor<Player>(
      perPlayer,
      compareChain((a, b) => b.streaks.longestWinStreak - a.streaks.longestWinStreak, byPoints, byGoalDiff, byName),
      (p) => ({ playerId: p.playerId, name: p.name, isGuest: p.isGuest, value: p.streaks.longestWinStreak })
    ),
    longestLossStreak: podiumFor<Player>(
      perPlayer,
      compareChain((a, b) => b.streaks.longestLossStreak - a.streaks.longestLossStreak, byPoints, byGoalDiff, byName),
      (p) => ({ playerId: p.playerId, name: p.name, isGuest: p.isGuest, value: p.streaks.longestLossStreak })
    ),
  };
}

/** Groups already-fetched rows by the calendar year of their gameday date. */
export function groupRowsByYear(rows: StatRow[]): Map<number, StatRow[]> {
  const byYear = new Map<number, StatRow[]>();
  for (const r of rows) {
    const year = r.date.getUTCFullYear();
    const list = byYear.get(year);
    if (list) list.push(r);
    else byYear.set(year, [r]);
  }
  return byYear;
}

/** Lifetime personal awards (never season-gated) - "wood" keeps the real number visible even before bronze is reached, so these always render. */
export function computePersonalAwards(career: CareerStats): PlayerAward[] {
  const values: Record<PersonalAwardCategory, number> = {
    gamesPlayed: career.gamesPlayed,
    wins: career.wins,
    draws: career.draws,
    losses: career.losses,
    points: career.points,
    goals: career.goals,
  };
  const awards: PlayerAward[] = [];
  for (const category of Object.keys(ACHIEVEMENT_THRESHOLDS) as PersonalAwardCategory[]) {
    const tier = tierForValue(category, values[category]);
    awards.push({ category, tier, kind: "personal", value: values[category] });
  }
  return awards;
}

/**
 * This player's season awards, one entry per completed season they placed
 * top-3 in for any category. `allRows` is unfiltered (all-time, all
 * players) - completed seasons are derived from it and the current
 * in-progress year is always excluded, per the "not awarded until the
 * season ends" rule.
 */
export function computePlayerSeasonAwards(allRows: StatRow[], playerId: number): PlayerAward[] {
  const currentYear = new Date().getUTCFullYear();
  const byYear = groupRowsByYear(allRows);

  const awards: PlayerAward[] = [];
  for (const [year, yearRows] of byYear) {
    if (year >= currentYear) continue;
    const podiums = computeSeasonPodiums(yearRows);
    for (const category of Object.keys(podiums) as SeasonAwardCategory[]) {
      const podium = podiums[category];
      for (const tier of ["gold", "silver", "bronze"] as const) {
        const entry = podium[tier];
        if (entry && entry.playerId === playerId) awards.push({ category, tier, kind: "season", season: year, value: entry.value });
      }
    }
  }
  return awards.sort((a, b) => (b.season ?? 0) - (a.season ?? 0));
}
