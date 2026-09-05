export type UserStatus = "PENDING" | "APPROVED" | "REJECTED";
export type GamedayStatus = "OPEN" | "CLOSED" | "CANCELLED" | "COMPLETED";
export type RegistrationStatus = "CONFIRMED" | "WAITLISTED" | "CANCELLED";
export type Team = "A" | "B";

export interface User {
  id: number;
  email: string;
  status: UserStatus;
  isAdmin: boolean;
  playerId: number | null;
  createdAt: string;
}

export interface Player {
  id: number;
  name: string;
  isGuest: boolean;
  addedByUserId: number | null;
}

export interface PlayerMerge {
  id: number;
  guestPlayerName: string;
  targetPlayer: { id: number; name: string };
  mergedBy: { id: number; email: string };
  undoneAt: string | null;
  createdAt: string;
}

export interface GamedaySummary {
  id: number;
  date: string;
  status: GamedayStatus;
  minPlayers: number;
  maxPlayers: number;
  confirmedCount: number;
  waitlistedCount: number;
  result: { teamAScore: number; teamBScore: number } | null;
}

export interface RegistrationView {
  id: number;
  status: RegistrationStatus;
  signupAt: string;
  player: { id: number; name: string; isGuest: boolean };
  registeredBy: { id: number; email: string };
}

export interface TeamAssignmentView {
  id: number;
  team: Team;
  player: { id: number; name: string; isGuest: boolean };
}

export interface PlayerGamedayStatView {
  id: number;
  team: Team;
  points: number;
  goalDiff: number;
  player: { id: number; name: string; isGuest: boolean };
}

export interface ResultView {
  id: number;
  teamAScore: number;
  teamBScore: number;
  playerStats: PlayerGamedayStatView[];
}

export interface GamedayDetail {
  id: number;
  date: string;
  status: GamedayStatus;
  minPlayers: number;
  maxPlayers: number;
  notes: string | null;
  createdByUserId: number;
  registrations: RegistrationView[];
  teamAssignments: TeamAssignmentView[];
  result: ResultView | null;
}

export interface StandingRow {
  rank: number;
  playerId: number;
  name: string;
  points: number;
  goalDiff: number;
  gamesPlayed: number;
  /** Rank places gained (positive) or lost (negative) since the last gameday; "new" = no prior rank to compare against. */
  momentum: number | "new";
  currentForm: CurrentForm;
}

/**
 * Competitive (season) awards and the isAdmin badge are always exactly
 * gold/silver/bronze - if not earned, simply absent. The lifetime stat
 * categories always render instead, using "wood" as the below-bronze rung
 * so the real value stays visible.
 */
export type AwardTier = "gold" | "silver" | "bronze" | "wood";

export type PersonalAwardCategory = "gamesPlayed" | "wins" | "draws" | "losses" | "points" | "goals" | "isAdmin";
export type SeasonAwardCategory = "ranking" | "mostGames" | "mostGoals" | "longestWinStreak" | "longestLossStreak";
export type AwardCategory = PersonalAwardCategory | SeasonAwardCategory;

export interface PlayerAward {
  category: AwardCategory;
  tier: AwardTier;
  kind: "personal" | "season";
  season?: number;
  value: number;
}

export interface TeammateRecord {
  playerId: number;
  name: string;
  sharedGames: number;
  sharedWins: number;
  sharedLosses: number;
  avatarDataUri: string | null;
}

/** Transient - unlike awards these can be lost the moment the next game changes the picture. */
export interface CurrentForm {
  veteran: boolean;
  undefeated: boolean;
  unlucky: boolean;
}

export interface PlayerProfile {
  player: { id: number; name: string; isGuest: boolean; avatarDataUri: string | null; joinedAt: string };
  awards: PlayerAward[];
  currentForm: CurrentForm;
  teammates: { favorite: TeammateRecord | null; unfavorite: TeammateRecord | null; mostPlayedWith: TeammateRecord | null };
}

export interface PodiumEntry {
  playerId: number;
  name: string;
  value: number;
}

/** There is always at most one winner per medal - ties are resolved by secondary factors. */
export interface PodiumAward {
  gold: PodiumEntry | null;
  silver: PodiumEntry | null;
  bronze: PodiumEntry | null;
}

export interface HallOfFameResponse {
  year: number;
  seasonComplete: boolean;
  podiums: Record<SeasonAwardCategory, PodiumAward>;
}
