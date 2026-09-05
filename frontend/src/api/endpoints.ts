import { apiRequest, API_BASE, getAuthToken, ApiClientError } from "./client";
import type {
  GamedayDetail,
  GamedaySummary,
  HallOfFameResponse,
  Invite,
  Player,
  PlayerMerge,
  PlayerProfile,
  StandingRow,
  Team,
  User,
} from "./types";

// ---- auth ----

export function login(name: string, password: string) {
  return apiRequest<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: { name, password },
  });
}

export function fetchMe() {
  return apiRequest<{ user: User; player: Player | null }>("/auth/me");
}

export function updateMe(data: { name?: string; email?: string; currentPassword?: string; newPassword?: string }) {
  return apiRequest<{ user: User; player: Player | null }>("/auth/me", { method: "PATCH", body: data });
}

// ---- admin: users ----

export function adminListUsers(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return apiRequest<{ users: (User & { player: Player | null })[] }>(`/admin/users${qs}`);
}

export function adminListGuestPlayers() {
  return apiRequest<{ guests: (Player & { gamesPlayed: number })[] }>("/admin/players/guests");
}

export function adminSetRoles(id: number, roles: { isAdmin?: boolean }) {
  return apiRequest<{ user: User }>(`/admin/users/${id}/roles`, { method: "PATCH", body: roles });
}

export function adminDeleteUser(id: number) {
  return apiRequest<void>(`/admin/users/${id}`, { method: "DELETE" });
}

export function adminListMerges() {
  return apiRequest<{ merges: PlayerMerge[] }>("/admin/players/merges");
}

export function adminUndoMerge(id: number) {
  return apiRequest<{ guest: Player }>(`/admin/players/merges/${id}/undo`, { method: "POST" });
}

/** Attaches an unclaimed guest's history to an already-claimed player (unlike the invite flow, which promotes a guest into a brand-new account). */
export function adminMergeIntoPlayer(targetPlayerId: number, guestPlayerId: number) {
  return apiRequest<{ ok: true }>(`/admin/players/${targetPlayerId}/merge`, { method: "POST", body: { guestPlayerId } });
}

// ---- admin: invites ----
// There is no self-service registration - accounts only come from an admin
// creating one of these and sharing the resulting link.

export function adminListInvites() {
  return apiRequest<{ invites: Invite[] }>("/admin/invites");
}

export function adminCreateInvite(data: { guestPlayerId: number; note?: string; expiresInDays?: number }) {
  return apiRequest<{ invite: Invite }>("/admin/invites", { method: "POST", body: data });
}

export function adminRevokeInvite(id: number) {
  return apiRequest<{ invite: Invite }>(`/admin/invites/${id}/revoke`, { method: "POST" });
}

// ---- invites (public - accepting one is how an account gets created) ----

export function getInvite(token: string) {
  return apiRequest<{ guest: { id: number; name: string } }>(`/invites/${token}`);
}

export async function acceptInvite(
  token: string,
  data: { name: string; password: string; email?: string; avatar?: File }
) {
  const form = new FormData();
  form.append("name", data.name);
  form.append("password", data.password);
  if (data.email) form.append("email", data.email);
  if (data.avatar) form.append("avatar", data.avatar);

  const res = await fetch(`${API_BASE}/invites/${token}/accept`, { method: "POST", body: form });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => ({})) : undefined;
  if (!res.ok) {
    const message = (body && (body as any).error) || res.statusText || "Could not complete onboarding";
    throw new ApiClientError(res.status, message, body && (body as any).details);
  }
  return body as { token: string; user: User };
}

// ---- guests ----

/** Every guest player system-wide (including ones imported from the legacy spreadsheet), not just ones the current user added. */
export function listGuests() {
  return apiRequest<{ guests: Player[] }>("/guests");
}

/** Finds an existing guest by name (case-insensitive) or creates a new one - never a duplicate. */
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

export function getPlayerProfile(id: number) {
  return apiRequest<PlayerProfile>(`/players/${id}/profile`);
}

export async function uploadAvatar(playerId: number, file: File) {
  const form = new FormData();
  form.append("avatar", file);
  const res = await fetch(`${API_BASE}/players/${playerId}/avatar`, {
    method: "PUT",
    headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : undefined,
    body: form,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : undefined;
  if (!res.ok) {
    const message = (data && (data as any).error) || res.statusText || "Upload failed";
    throw new ApiClientError(res.status, message, data && (data as any).details);
  }
  return data as { player: Player };
}

// ---- gamedays ----

export function listGamedays(season?: number) {
  const qs = season ? `?season=${season}` : "";
  return apiRequest<{ gamedays: GamedaySummary[] }>(`/gamedays${qs}`);
}

export function getGameday(id: number) {
  return apiRequest<{ gameday: GamedayDetail }>(`/gamedays/${id}`);
}

export function createGameday(data: { date: string; minPlayers?: number; maxPlayers?: number; notes?: string }) {
  return apiRequest<{ gameday: GamedayDetail }>("/gamedays", { method: "POST", body: data });
}

export function updateGameday(id: number, data: Partial<{ date: string; status: string; minPlayers: number; maxPlayers: number; notes: string }>) {
  return apiRequest<{ gameday: GamedayDetail }>(`/gamedays/${id}`, { method: "PATCH", body: data });
}

export function deleteGameday(id: number) {
  return apiRequest<void>(`/gamedays/${id}`, { method: "DELETE" });
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

// ---- hall of fame ----

export function getHallOfFame(year?: number) {
  const qs = year ? `?year=${year}` : "";
  return apiRequest<HallOfFameResponse>(`/hall-of-fame${qs}`);
}
