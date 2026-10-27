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

export function publicGameday(over: Partial<import("../api/types").GamedayPublicSummary> = {}): import("../api/types").GamedayPublicSummary {
  return {
    id: 5,
    date: "2026-10-29T17:00:00.000Z",
    status: "OPEN",
    minPlayers: 8,
    maxPlayers: 12,
    confirmedCount: 0,
    waitlistedCount: 0,
    confirmed: [],
    waitlisted: [],
    myStatus: null,
    weather: null,
    ...over,
  };
}

export function registration(
  id: number,
  name: string,
  status: import("../api/types").RegistrationStatus = "CONFIRMED",
  over: { playerId?: number; isGuest?: boolean; registeredById?: number | null; electorRank?: 1 | 2 | null } = {}
): import("../api/types").RegistrationView {
  return {
    id,
    status,
    signupAt: "2026-10-20T10:00:00.000Z",
    player: {
      id: over.playerId ?? id * 10,
      name,
      isGuest: over.isGuest ?? false,
      currentForm: noForm,
      isNewcomer: false,
      previousSeasonTitle: null,
      electorRank: over.electorRank ?? null,
    },
    registeredBy: over.registeredById === null ? null : { id: over.registeredById ?? 1 },
  };
}

export function gamedayDetail(over: Partial<import("../api/types").GamedayDetail> = {}): import("../api/types").GamedayDetail {
  return {
    id: 5,
    date: "2026-10-29T17:00:00.000Z",
    status: "OPEN",
    minPlayers: 8,
    maxPlayers: 12,
    notes: null,
    createdByUserId: 1,
    shareToken: null,
    registrations: [],
    teamAssignments: [],
    result: null,
    weather: null,
    ...over,
  };
}
