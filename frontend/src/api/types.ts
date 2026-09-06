export type GamedayStatus = "OPEN" | "CLOSED" | "CANCELLED" | "COMPLETED";
export type RegistrationStatus = "CONFIRMED" | "WAITLISTED" | "CANCELLED";
export type Team = "A" | "B";

export interface User {
  id: number;
  email: string | null;
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
  mergedBy: { id: number; email: string | null };
  undoneAt: string | null;
  createdAt: string;
}

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

export interface Invite {
  id: number;
  token: string;
  note: string | null;
  guestPlayer: { id: number; name: string };
  createdBy: { id: number; email: string | null };
  expiresAt: string;
  usedAt: string | null;
  usedBy: { id: number; email: string | null } | null;
  revokedAt: string | null;
  createdAt: string;
  status: InviteStatus;
}

export interface GamedaySummary {
  id: number;
  date: string;
  status: GamedayStatus;
  minPlayers: number;
  maxPlayers: number;
  /** 1-based position of this gameday within its own calendar year, chronologically. */
  matchday: number;
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
  shareToken: string | null;
  registrations: RegistrationView[];
  teamAssignments: TeamAssignmentView[];
  result: ResultView | null;
}

/** What an anonymous visitor holding a matchday's share link sees - no emails/admin controls, just who's in. */
export interface GamedayPublicSummary {
  id: number;
  date: string;
  status: GamedayStatus;
  minPlayers: number;
  maxPlayers: number;
  confirmedCount: number;
  waitlistedCount: number;
  confirmed: { name: string; isGuest: boolean }[];
  waitlisted: { name: string; isGuest: boolean }[];
  /** Status of the player id passed as ?playerId=, if any - lets a returning guest see their own signup. */
  myStatus: "CONFIRMED" | "WAITLISTED" | null;
}

export interface StandingRow {
  rank: number;
  playerId: number;
  name: string;
  isGuest: boolean;
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

export interface OpponentRecord {
  playerId: number;
  name: string;
  gamesAgainst: number;
  lossesAgainst: number;
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
  nemesis: OpponentRecord | null;
}

export interface PodiumEntry {
  playerId: number;
  name: string;
  isGuest: boolean;
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
