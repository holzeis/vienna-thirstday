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
  /** Null if the admin who performed this merge was later deleted. */
  mergedBy: { id: number; email: string | null } | null;
  undoneAt: string | null;
  createdAt: string;
}

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

export interface InviteRedemption {
  id: number;
  playerId: number | null;
  playerName: string;
  createdAt: string;
}

export interface Invite {
  id: number;
  token: string;
  note: string | null;
  /** Null for an "open" invite - reusable, no guest, each acceptance creates a brand-new player. */
  guestPlayer: { id: number; name: string } | null;
  /** Null if the admin who issued this invite was later deleted. */
  createdBy: { id: number; email: string | null } | null;
  expiresAt: string;
  usedAt: string | null;
  usedBy: { id: number; email: string | null } | null;
  revokedAt: string | null;
  createdAt: string;
  status: InviteStatus;
  /** Everyone who has joined via this link - for a guest-linked invite, at most one. */
  redemptions: InviteRedemption[];
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
  /** Whether the caller has a stat row in this gameday's result - false if they didn't play (or it hasn't been played yet). */
  played: boolean;
}

export interface RegistrationView {
  id: number;
  status: RegistrationStatus;
  signupAt: string;
  player: { id: number; name: string; isGuest: boolean };
  /** Null if the user who registered this player was later deleted. */
  registeredBy: { id: number; email: string } | null;
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

export type PreviousSeasonTitle = "champion" | "viceChampion" | null;

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
  /** Gold/silver of the season immediately before this one, if this player held it. */
  previousSeasonTitle: PreviousSeasonTitle;
}

/**
 * Competitive (season) awards are always exactly gold/silver/bronze - if not
 * earned, simply absent. The lifetime stat categories always render instead,
 * using "wood" as the below-bronze rung so the real value stays visible.
 */
export type AwardTier = "gold" | "silver" | "bronze" | "wood";

export type PersonalAwardCategory = "gamesPlayed" | "wins" | "draws" | "losses" | "points" | "goals";
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
  winsAgainst: number;
  avatarDataUri: string | null;
}

/** Transient - unlike awards these can be lost the moment the next game changes the picture. */
export interface CurrentForm {
  veteran: boolean;
  undefeated: boolean;
  unlucky: boolean;
  ghost: boolean;
}

export interface PlayerProfile {
  player: { id: number; name: string; isGuest: boolean; isAdmin: boolean; avatarDataUri: string | null; joinedAt: string };
  awards: PlayerAward[];
  currentForm: CurrentForm;
  /** Current active win streak (3+), independent of the fixed last-5-window form badges above. */
  onFireStreak: number | null;
  /** This is the player's first-ever season. */
  isNewcomer: boolean;
  teammates: {
    favorite: TeammateRecord | null;
    unfavorite: TeammateRecord | null;
    mostPlayedWith: TeammateRecord | null;
    /** Best shared win-rate this season (min. shared games) - unlike the others, season-scoped rather than last-5-window. */
    dreamTeam: TeammateRecord | null;
  };
  nemesis: OpponentRecord | null;
  /** Mirror of nemesis: the opponent beaten most within the same window. */
  favoriteVictim: OpponentRecord | null;
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
