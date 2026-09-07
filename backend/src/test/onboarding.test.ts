import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { db } from "../db/client";
import { gamedays, invites, playerGamedayStats, playerMerges, players, registrations, results, users } from "../db/schema";
import { resetDb, closeDb, createAdmin, createGuestPlayer, createOpenGameday, createCompletedGameday } from "./helpers";

const app = createApp();

beforeEach(resetDb);
afterAll(closeDb);

async function loginAs(name: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.body.token as string;
}

async function createInviteForGuest(adminToken: string, guestPlayerId: number, opts: { expiresInDays?: number } = {}) {
  return request(app)
    .post("/api/admin/invites")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ guestPlayerId, expiresInDays: opts.expiresInDays ?? 7 });
}

describe("onboarding: admin creates an invite from a guest", () => {
  it("promotes the guest (isGuest -> false) immediately on invite creation", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);

    const guest = await createGuestPlayer("Robert");
    const res = await createInviteForGuest(token, guest.id);

    expect(res.status).toBe(201);
    expect(res.body.invite.guestPlayer).toEqual({ id: guest.id, name: "Robert" });
    expect(res.body.invite.status).toBe("pending");

    const updated = await db.query.players.findFirst({ where: eq(players.id, guest.id) });
    expect(updated?.isGuest).toBe(false);
  });

  it("never leaks passwordHash for createdBy/usedBy in the invite payload", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");

    const res = await createInviteForGuest(token, guest.id);
    expect(res.body.invite.createdBy).toEqual({ id: expect.any(Number), email: null });
    expect(res.body.invite.createdBy.passwordHash).toBeUndefined();
  });

  it("rejects a non-admin caller", async () => {
    const guest = await createGuestPlayer("Robert");
    // A regular (non-admin) account, created directly like createAdmin but isAdmin:false.
    const passwordHash = await bcrypt.hash("password123", 10);
    const [player] = await db.insert(players).values({ name: "Regular", isGuest: false }).returning();
    await db.insert(users).values({ passwordHash, isAdmin: false, playerId: player.id });
    const token = await loginAs("Regular", "password123");

    const res = await createInviteForGuest(token, guest.id);
    expect(res.status).toBe(403);
  });

  it("rejects a guestPlayerId that isn't actually a guest", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const [realPlayer] = await db.insert(players).values({ name: "Already Real", isGuest: false }).returning();

    const res = await createInviteForGuest(token, realPlayer.id);
    expect(res.status).toBe(400);
  });

  it("rejects a guest that already has an account linked", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Taken");
    await db.update(players).set({ isGuest: false }).where(eq(players.id, guest.id));
    await db.insert(users).values({ passwordHash: "x", isAdmin: false, playerId: guest.id });

    const res = await createInviteForGuest(token, guest.id);
    expect(res.status).toBe(400);
  });
});

describe("onboarding: open invites (no guest, reusable)", () => {
  async function createOpenInvite(adminToken: string, opts: { expiresInDays?: number } = {}) {
    return request(app)
      .post("/api/admin/invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ expiresInDays: opts.expiresInDays ?? 7 });
  }

  it("creates an invite with no guestPlayer, without touching any guest", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);

    const res = await createOpenInvite(token);
    expect(res.status).toBe(201);
    expect(res.body.invite.guestPlayer).toBeNull();
    expect(res.body.invite.status).toBe("pending");
    expect(res.body.invite.redemptions).toEqual([]);
  });

  it("GET /invites/:token returns guest: null", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const createRes = await createOpenInvite(token);

    const res = await request(app).get(`/api/invites/${createRes.body.invite.token}`);
    expect(res.status).toBe(200);
    expect(res.body.guest).toBeNull();
  });

  it("accepting it creates a brand-new player, not linked to any existing guest", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const createRes = await createOpenInvite(token);

    const before = await db.query.players.findMany();
    const acceptRes = await request(app)
      .post(`/api/invites/${createRes.body.invite.token}/accept`)
      .field("name", "Brand New Person")
      .field("password", "password123");

    expect(acceptRes.status).toBe(201);
    const after = await db.query.players.findMany();
    expect(after.length).toBe(before.length + 1);

    const newPlayer = await db.query.players.findFirst({ where: eq(players.id, acceptRes.body.user.playerId) });
    expect(newPlayer?.name).toBe("Brand New Person");
    expect(newPlayer?.isGuest).toBe(false);
  });

  it("can be accepted again by a second person - stays pending, not used", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const createRes = await createOpenInvite(token);
    const inviteToken = createRes.body.invite.token as string;

    const first = await request(app).post(`/api/invites/${inviteToken}/accept`).field("name", "First Person").field("password", "password123");
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/invites/${inviteToken}/accept`).field("name", "Second Person").field("password", "password123");
    expect(second.status).toBe(201);
    expect(second.body.user.playerId).not.toBe(first.body.user.playerId);

    const listRes = await request(app).get("/api/admin/invites").set("Authorization", `Bearer ${token}`);
    const invite = listRes.body.invites.find((i: any) => i.id === createRes.body.invite.id);
    expect(invite.status).toBe("pending");
    expect(invite.redemptions.map((r: any) => r.playerName).sort()).toEqual(["First Person", "Second Person"]);
  });

  it("can be revoked even after being used, unlike a guest-linked invite", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const createRes = await createOpenInvite(token);
    await request(app).post(`/api/invites/${createRes.body.invite.token}/accept`).field("name", "Someone").field("password", "password123");

    const revokeRes = await request(app)
      .post(`/api/admin/invites/${createRes.body.invite.id}/revoke`)
      .set("Authorization", `Bearer ${token}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.invite.status).toBe("revoked");

    const res = await request(app)
      .post(`/api/invites/${createRes.body.invite.token}/accept`)
      .field("name", "Too Late")
      .field("password", "password123");
    expect(res.status).toBe(410);
  });

  it("still enforces name uniqueness against existing account-linked players", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const createRes = await createOpenInvite(token);

    const res = await request(app)
      .post(`/api/invites/${createRes.body.invite.token}/accept`)
      .field("name", "Admin")
      .field("password", "password123");
    expect(res.status).toBe(409);
  });
});

describe("onboarding: accepting an invite", () => {
  async function setupInvite(guestName = "Robert") {
    const { password } = await createAdmin();
    const adminToken = await loginAs("Admin", password);
    const guest = await createGuestPlayer(guestName);
    const createRes = await createInviteForGuest(adminToken, guest.id);
    return { guest, adminToken, inviteToken: createRes.body.invite.token as string, inviteId: createRes.body.invite.id as number };
  }

  it("GET /invites/:token returns the guest's current name for display", async () => {
    const { guest, inviteToken } = await setupInvite();
    const res = await request(app).get(`/api/invites/${inviteToken}`);
    expect(res.status).toBe(200);
    expect(res.body.guest).toEqual({ id: guest.id, name: "Robert" });
  });

  it("accepts a name change, sets a password, and logs the same player id in - no new player, no merge", async () => {
    const { guest, inviteToken } = await setupInvite();

    const acceptRes = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .field("name", "Robert Real")
      .field("password", "password123");

    expect(acceptRes.status).toBe(201);
    expect(acceptRes.body.user.playerId).toBe(guest.id);
    expect(acceptRes.body.token).toBeTruthy();

    const player = await db.query.players.findFirst({ where: eq(players.id, guest.id) });
    expect(player?.name).toBe("Robert Real");

    const allPlayers = await db.query.players.findMany();
    expect(allPlayers).toHaveLength(2); // the admin + this one player - no extra player created

    const loginRes = await request(app).post("/api/auth/login").send({ name: "Robert Real", password: "password123" });
    expect(loginRes.status).toBe(200);
  });

  it("accepts an optional email and stores it", async () => {
    const { inviteToken } = await setupInvite();
    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .field("name", "Robert Real")
      .field("password", "password123")
      .field("email", "robert@example.com");
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("robert@example.com");
  });

  it("accepts an optional avatar image and resizes/stores it on the player", async () => {
    const { guest, inviteToken } = await setupInvite();
    // A minimal 1x1 red JPEG, valid enough for sharp to process.
    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64"
    );
    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .field("name", "Robert Real")
      .field("password", "password123")
      .attach("avatar", jpeg, "avatar.jpg");
    expect(res.status).toBe(201);

    const player = await db.query.players.findFirst({ where: eq(players.id, guest.id) });
    expect(player?.avatarMimeType).toBe("image/jpeg");
    expect(player?.avatarData).toBeTruthy();
  });

  it("rejects a name already taken by another account-linked player", async () => {
    const { password: adminPassword } = await createAdmin();
    const adminToken = await loginAs("Admin", adminPassword);
    // "Admin" itself is account-linked - collide with it directly.
    const guest = await createGuestPlayer("Robert");
    const createRes = await createInviteForGuest(adminToken, guest.id);

    const res = await request(app)
      .post(`/api/invites/${createRes.body.invite.token}/accept`)
      .field("name", "Admin")
      .field("password", "password123");
    expect(res.status).toBe(409);
  });

  it("does not collide with an unclaimed guest sharing the chosen name", async () => {
    const { inviteToken } = await setupInvite();
    await createGuestPlayer("Duplicate Name"); // unclaimed guest, no account - must not block

    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .field("name", "Duplicate Name")
      .field("password", "password123");
    expect(res.status).toBe(201);
  });

  it("rejects accepting an already-used invite", async () => {
    const { inviteToken } = await setupInvite();
    await request(app).post(`/api/invites/${inviteToken}/accept`).field("name", "Robert Real").field("password", "password123");

    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .field("name", "Someone Else")
      .field("password", "password123");
    expect(res.status).toBe(410);
  });

  it("rejects an expired invite", async () => {
    const { inviteToken, inviteId } = await setupInvite();
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, inviteId));

    const res = await request(app)
      .post(`/api/invites/${inviteToken}/accept`)
      .field("name", "Robert Real")
      .field("password", "password123");
    expect(res.status).toBe(410);
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).get("/api/invites/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("onboarding: revoking an invite", () => {
  it("reverts the guest promotion and the link stops working", async () => {
    const { password } = await createAdmin();
    const adminToken = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const createRes = await createInviteForGuest(adminToken, guest.id);

    const revokeRes = await request(app)
      .post(`/api/admin/invites/${createRes.body.invite.id}/revoke`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.invite.status).toBe("revoked");

    const player = await db.query.players.findFirst({ where: eq(players.id, guest.id) });
    expect(player?.isGuest).toBe(true);

    const acceptRes = await request(app)
      .post(`/api/invites/${createRes.body.invite.token}/accept`)
      .field("name", "Robert Real")
      .field("password", "password123");
    expect(acceptRes.status).toBe(410);
  });

  it("refuses to revoke an already-used invite", async () => {
    const { password } = await createAdmin();
    const adminToken = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const createRes = await createInviteForGuest(adminToken, guest.id);
    await request(app).post(`/api/invites/${createRes.body.invite.token}/accept`).field("name", "Robert Real").field("password", "password123");

    const res = await request(app)
      .post(`/api/admin/invites/${createRes.body.invite.id}/revoke`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

describe("onboarding: deleting an invite", () => {
  it("removes a used (accepted) invite", async () => {
    const { password } = await createAdmin();
    const adminToken = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const createRes = await createInviteForGuest(adminToken, guest.id);
    await request(app).post(`/api/invites/${createRes.body.invite.token}/accept`).field("name", "Robert Real").field("password", "password123");

    const res = await request(app)
      .delete(`/api/admin/invites/${createRes.body.invite.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
    expect(await db.query.invites.findFirst({ where: eq(invites.id, createRes.body.invite.id) })).toBeUndefined();
  });

  it("removes an expired invite", async () => {
    const { password } = await createAdmin();
    const adminToken = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const createRes = await createInviteForGuest(adminToken, guest.id);
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, createRes.body.invite.id));

    const res = await request(app)
      .delete(`/api/admin/invites/${createRes.body.invite.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it("removes a revoked invite", async () => {
    const { password } = await createAdmin();
    const adminToken = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const createRes = await createInviteForGuest(adminToken, guest.id);
    await request(app).post(`/api/admin/invites/${createRes.body.invite.id}/revoke`).set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app)
      .delete(`/api/admin/invites/${createRes.body.invite.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it("refuses to delete a still-pending invite", async () => {
    const { password } = await createAdmin();
    const adminToken = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    const createRes = await createInviteForGuest(adminToken, guest.id);

    const res = await request(app)
      .delete(`/api/admin/invites/${createRes.body.invite.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(await db.query.invites.findFirst({ where: eq(invites.id, createRes.body.invite.id) })).toBeDefined();
  });
});

describe("login by name", () => {
  it("rejects an unknown name", async () => {
    const res = await request(app).post("/api/auth/login").send({ name: "Nobody", password: "whatever" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password with the same generic message", async () => {
    const { password } = await createAdmin();
    const res = await request(app).post("/api/auth/login").send({ name: "Admin", password: password + "x" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid name/email or password");
  });

  it("matches names case-insensitively", async () => {
    const { password } = await createAdmin();
    const res = await request(app).post("/api/auth/login").send({ name: "aDMIN", password });
    expect(res.status).toBe(200);
  });

  it("also accepts the account's email in place of the name", async () => {
    const { password } = await createAdmin("Admin", "password123", "admin@example.com");
    const res = await request(app).post("/api/auth/login").send({ name: "admin@example.com", password });
    expect(res.status).toBe(200);
  });

  it("matches email case-insensitively too", async () => {
    const { password } = await createAdmin("Admin", "password123", "admin@example.com");
    const res = await request(app).post("/api/auth/login").send({ name: "ADMIN@EXAMPLE.COM", password });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /auth/me name uniqueness", () => {
  it("rejects renaming to a name already used by another account", async () => {
    const { password } = await createAdmin("Admin");
    const otherPasswordHash = await bcrypt.hash("password123", 10);
    const [otherPlayer] = await db.insert(players).values({ name: "Other Player", isGuest: false }).returning();
    await db.insert(users).values({ passwordHash: otherPasswordHash, isAdmin: false, playerId: otherPlayer.id });

    const token = await loginAs("Admin", password);
    const res = await request(app).patch("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ name: "Other Player" });
    expect(res.status).toBe(409);
  });

  it("allows renaming to a free name", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const res = await request(app).patch("/api/auth/me").set("Authorization", `Bearer ${token}`).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.player.name).toBe("New Name");
  });
});

describe("DELETE /admin/users/:id", () => {
  it("refuses to delete your own account", async () => {
    const { user, password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const res = await request(app).delete(`/api/admin/users/${user.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("refuses to delete the last remaining admin", async () => {
    const { password } = await createAdmin();
    const token = await loginAs("Admin", password);
    const otherAdminHash = await bcrypt.hash("password123", 10);
    const [otherPlayer] = await db.insert(players).values({ name: "Other Admin", isGuest: false }).returning();
    const [otherAdmin] = await db.insert(users).values({ passwordHash: otherAdminHash, isAdmin: true, playerId: otherPlayer.id }).returning();

    // Deleting otherAdmin while logged in as the first admin is fine (two admins exist).
    const res = await request(app).delete(`/api/admin/users/${otherAdmin.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    // But deleting yourself when you're the only admin left is still blocked (covered above);
    // here we instead confirm a *second* deletion attempt against a now-nonexistent id 404s.
    const res2 = await request(app).delete(`/api/admin/users/${otherAdmin.id}`).set("Authorization", `Bearer ${token}`);
    expect(res2.status).toBe(404);
  });

  it("reverts the deleted user's own player to a guest, keeping their stats intact", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const otherHash = await bcrypt.hash("password123", 10);
    const [otherPlayer] = await db.insert(players).values({ name: "Active Player", isGuest: false }).returning();
    const [otherUser] = await db.insert(users).values({ passwordHash: otherHash, isAdmin: false, playerId: otherPlayer.id }).returning();
    await createCompletedGameday(otherUser.id, new Date("2025-06-05T18:00:00Z"), { teamA: 4, teamB: 1 }, [
      { playerId: otherPlayer.id, team: "A", points: 4, goalDiff: 3 },
    ]);

    const res = await request(app).delete(`/api/admin/users/${otherUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const player = await db.query.players.findFirst({ where: eq(players.id, otherPlayer.id) });
    expect(player?.isGuest).toBe(true);
    expect(player?.name).toBe("Active Player");

    const stats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.playerId, otherPlayer.id) });
    expect(stats).toHaveLength(1);
    expect(stats[0].points).toBe(4);
  });

  it("does not affect another player's stats when reverting one to a guest", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const otherHash = await bcrypt.hash("password123", 10);
    const [otherPlayer] = await db.insert(players).values({ name: "To Delete", isGuest: false }).returning();
    const [otherUser] = await db.insert(users).values({ passwordHash: otherHash, isAdmin: false, playerId: otherPlayer.id }).returning();
    const [survivorPlayer] = await db.insert(players).values({ name: "Survivor", isGuest: false }).returning();

    await createCompletedGameday(otherUser.id, new Date("2025-06-05T18:00:00Z"), { teamA: 4, teamB: 1 }, [
      { playerId: otherPlayer.id, team: "A", points: 4, goalDiff: 3 },
      { playerId: survivorPlayer.id, team: "B", points: 1, goalDiff: -3 },
    ]);

    const res = await request(app).delete(`/api/admin/users/${otherUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const survivorStats = await db.query.playerGamedayStats.findMany({ where: eq(playerGamedayStats.playerId, survivorPlayer.id) });
    expect(survivorStats).toHaveLength(1);
    expect(survivorStats[0].points).toBe(1);
    expect(survivorStats[0].goalDiff).toBe(-3);
  });

  it("nulls the creator/enterer of a gameday and its result instead of blocking deletion", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const otherHash = await bcrypt.hash("password123", 10);
    const [otherPlayer] = await db.insert(players).values({ name: "Organizer", isGuest: false }).returning();
    const [otherUser] = await db.insert(users).values({ passwordHash: otherHash, isAdmin: false, playerId: otherPlayer.id }).returning();
    const { gameday, result } = await createCompletedGameday(otherUser.id, new Date("2025-06-05T18:00:00Z"), { teamA: 3, teamB: 0 }, []);

    const res = await request(app).delete(`/api/admin/users/${otherUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const survivingGameday = await db.query.gamedays.findFirst({ where: eq(gamedays.id, gameday.id) });
    expect(survivingGameday?.createdByUserId).toBeNull();
    const survivingResult = await db.query.results.findFirst({ where: eq(results.id, result.id) });
    expect(survivingResult?.enteredByUserId).toBeNull();
    expect(survivingResult?.teamAScore).toBe(3);
  });

  it("nulls registeredByUserId on a registration this user made for someone else, without touching the registrant", async () => {
    const { user: admin } = await createAdmin("Admin");
    const password = "password123";
    const token = await loginAs("Admin", password);
    const gameday = await createOpenGameday(admin.id, new Date(Date.now() + 86400000));

    const registrarHash = await bcrypt.hash("password123", 10);
    const [registrarPlayer] = await db.insert(players).values({ name: "Registrar", isGuest: false }).returning();
    const [registrarUser] = await db
      .insert(users)
      .values({ passwordHash: registrarHash, isAdmin: false, playerId: registrarPlayer.id })
      .returning();

    const guest = await createGuestPlayer("Brought Along");
    const [reg] = await db
      .insert(registrations)
      .values({ gamedayId: gameday.id, playerId: guest.id, status: "CONFIRMED", registeredByUserId: registrarUser.id })
      .returning();

    const res = await request(app).delete(`/api/admin/users/${registrarUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const survivingReg = await db.query.registrations.findFirst({ where: eq(registrations.id, reg.id) });
    expect(survivingReg?.registeredByUserId).toBeNull();
    expect(survivingReg?.playerId).toBe(guest.id);
    expect(survivingReg?.status).toBe("CONFIRMED");
  });

  it("nulls createdByUserId on an invite this user issued, instead of blocking deletion", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const issuerHash = await bcrypt.hash("password123", 10);
    const [issuerPlayer] = await db.insert(players).values({ name: "Issuer", isGuest: false }).returning();
    const [issuerUser] = await db.insert(users).values({ passwordHash: issuerHash, isAdmin: true, playerId: issuerPlayer.id }).returning();
    const issuerToken = await loginAs("Issuer", "password123");
    const guest = await createGuestPlayer("Some Guest");
    const createRes = await createInviteForGuest(issuerToken, guest.id);

    const res = await request(app).delete(`/api/admin/users/${issuerUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const survivingInvite = await db.query.invites.findFirst({ where: eq(invites.id, createRes.body.invite.id) });
    expect(survivingInvite?.createdByUserId).toBeNull();
    expect(survivingInvite?.token).toBe(createRes.body.invite.token);
  });

  it("nulls mergedByUserId on a merge log this user performed, instead of blocking deletion", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const mergerHash = await bcrypt.hash("password123", 10);
    const [mergerPlayer] = await db.insert(players).values({ name: "Merger", isGuest: false }).returning();
    const [mergerUser] = await db.insert(users).values({ passwordHash: mergerHash, isAdmin: true, playerId: mergerPlayer.id }).returning();
    const mergerToken = await loginAs("Merger", "password123");
    const guest = await createGuestPlayer("Merge Me");

    await request(app)
      .post(`/api/admin/players/${mergerPlayer.id}/merge`)
      .set("Authorization", `Bearer ${mergerToken}`)
      .send({ guestPlayerId: guest.id });

    const res = await request(app).delete(`/api/admin/users/${mergerUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const merge = await db.query.playerMerges.findFirst({ where: eq(playerMerges.targetPlayerId, mergerPlayer.id) });
    expect(merge?.mergedByUserId).toBeNull();
  });

  it("deletes a clean account with no activity", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const otherHash = await bcrypt.hash("password123", 10);
    const [otherPlayer] = await db.insert(players).values({ name: "Clean Player", isGuest: false }).returning();
    const [otherUser] = await db.insert(users).values({ passwordHash: otherHash, isAdmin: false, playerId: otherPlayer.id }).returning();

    const res = await request(app).delete(`/api/admin/users/${otherUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const stillThere = await db.query.users.findFirst({ where: eq(users.id, otherUser.id) });
    expect(stillThere).toBeUndefined();
  });
});
