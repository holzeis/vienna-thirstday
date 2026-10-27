import type { CurrentForm, GamedaySummary, StandingRow } from "../api/types";

export const noForm: CurrentForm = { veteran: false, undefeated: false, unlucky: false, ghost: false };

export function standingRow(over: Partial<StandingRow> = {}): StandingRow {
  return {
    rank: 1,
    playerId: 1,
    name: "Robert",
    isGuest: false,
    points: 10,
    goalDiff: 0,
    gamesPlayed: 3,
    momentum: 0,
    currentForm: noForm,
    isNewcomer: false,
    previousSeasonTitle: null,
    ...over,
  };
}

export function gamedaySummary(over: Partial<GamedaySummary> = {}): GamedaySummary {
  return {
    id: 1,
    date: "2026-10-22T17:00:00.000Z",
    status: "OPEN",
    minPlayers: 8,
    maxPlayers: 12,
    matchday: 1,
    confirmedCount: 0,
    waitlistedCount: 0,
    result: null,
    played: false,
    ...over,
  };
}
