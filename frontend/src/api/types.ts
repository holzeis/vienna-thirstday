export type UserStatus = "PENDING" | "APPROVED" | "REJECTED";
export type GamedayStatus = "OPEN" | "CLOSED" | "CANCELLED" | "COMPLETED";
export type RegistrationStatus = "CONFIRMED" | "WAITLISTED" | "CANCELLED";
export type Team = "A" | "B";

export interface User {
  id: number;
  email: string;
  status: UserStatus;
  isAdmin: boolean;
  isPlayer: boolean;
  playerId: number | null;
  createdAt: string;
}

export interface Player {
  id: number;
  name: string;
  isGuest: boolean;
  addedByUserId: number | null;
}

export interface GamedaySummary {
  id: number;
  date: string;
  location: string | null;
  status: GamedayStatus;
  minPlayers: number;
  maxPlayers: number;
  confirmedCount: number;
  waitlistedCount: number;
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
  location: string | null;
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
}
