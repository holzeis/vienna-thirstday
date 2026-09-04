import { apiRequest } from "./client";
import type {
  GamedayDetail,
  GamedaySummary,
  Player,
  StandingRow,
  Team,
  User,
} from "./types";

// ---- auth ----

export function login(email: string, password: string) {
  return apiRequest<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function register(email: string, password: string, name: string) {
  return apiRequest<{ message: string; user: User }>("/auth/register", {
    method: "POST",
    body: { email, password, name },
  });
}

export function fetchMe() {
  return apiRequest<{ user: User; player: Player | null }>("/auth/me");
}

// ---- admin: users ----

export function adminListUsers(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return apiRequest<{ users: (User & { player: Player | null })[] }>(`/admin/users${qs}`);
}

export function adminApproveUser(id: number) {
  return apiRequest<{ user: User }>(`/admin/users/${id}/approve`, { method: "POST" });
}

export function adminRejectUser(id: number) {
  return apiRequest<{ user: User }>(`/admin/users/${id}/reject`, { method: "POST" });
}

export function adminSetRoles(id: number, roles: { isAdmin?: boolean; isPlayer?: boolean }) {
  return apiRequest<{ user: User }>(`/admin/users/${id}/roles`, { method: "PATCH", body: roles });
}

// ---- guests ----

export function listMyGuests() {
  return apiRequest<{ guests: Player[] }>("/guests");
}

export function createGuest(name: string) {
  return apiRequest<{ guest: Player }>("/guests", { method: "POST", body: { name } });
}

export function deleteGuest(id: number) {
  return apiRequest<void>(`/guests/${id}`, { method: "DELETE" });
}

// ---- players ----

export function listPlayers() {
  return apiRequest<{ players: Player[] }>("/players");
}

// ---- gamedays ----

export function listGamedays(season?: number) {
  const qs = season ? `?season=${season}` : "";
  return apiRequest<{ gamedays: GamedaySummary[] }>(`/gamedays${qs}`);
}

export function getGameday(id: number) {
  return apiRequest<{ gameday: GamedayDetail }>(`/gamedays/${id}`);
}

export function createGameday(data: { date: string; location?: string; minPlayers?: number; maxPlayers?: number; notes?: string }) {
  return apiRequest<{ gameday: GamedayDetail }>("/gamedays", { method: "POST", body: data });
}

export function updateGameday(id: number, data: Partial<{ date: string; location: string; status: string; minPlayers: number; maxPlayers: number; notes: string }>) {
  return apiRequest<{ gameday: GamedayDetail }>(`/gamedays/${id}`, { method: "PATCH", body: data });
}

export function registerForGameday(gamedayId: number, playerId?: number) {
  return apiRequest<{ message: string }>(`/gamedays/${gamedayId}/register`, {
    method: "POST",
    body: playerId ? { playerId } : {},
  });
}

export function cancelRegistration(gamedayId: number, registrationId: number) {
  return apiRequest<void>(`/gamedays/${gamedayId}/register/${registrationId}`, { method: "DELETE" });
}

export function setTeams(gamedayId: number, assignments: { playerId: number; team: Team }[]) {
  return apiRequest<{ message: string }>(`/gamedays/${gamedayId}/teams`, { method: "PUT", body: { assignments } });
}

export function setResult(gamedayId: number, teamAScore: number, teamBScore: number) {
  return apiRequest<{ message: string }>(`/gamedays/${gamedayId}/result`, {
    method: "PUT",
    body: { teamAScore, teamBScore },
  });
}

// ---- standings ----

export function listSeasons() {
  return apiRequest<{ seasons: number[] }>("/seasons");
}

export function getStandings(year: number) {
  return apiRequest<{ year: number; standings: StandingRow[] }>(`/seasons/${year}/standings`);
}
