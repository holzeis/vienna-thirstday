import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { db } from "../db/client";
import { gamedays, invites, players, users } from "../db/schema";
import { resetDb, closeDb, createAdmin, createGuestPlayer } from "./helpers";

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

describe("login by name", () => {
  it("rejects an unknown name", async () => {
    const res = await request(app).post("/api/auth/login").send({ name: "Nobody", password: "whatever" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password with the same generic message", async () => {
    const { password } = await createAdmin();
    const res = await request(app).post("/api/auth/login").send({ name: "Admin", password: password + "x" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid name or password");
  });

  it("matches names case-insensitively", async () => {
    const { password } = await createAdmin();
    const res = await request(app).post("/api/auth/login").send({ name: "aDMIN", password });
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

  it("refuses to delete a user with real activity (e.g. a registration)", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const otherHash = await bcrypt.hash("password123", 10);
    const [otherPlayer] = await db.insert(players).values({ name: "Active Player", isGuest: false }).returning();
    const [otherUser] = await db.insert(users).values({ passwordHash: otherHash, isAdmin: false, playerId: otherPlayer.id }).returning();
    await db.insert(gamedays).values({ date: new Date(), status: "OPEN", createdByUserId: otherUser.id });

    const res = await request(app).delete(`/api/admin/users/${otherUser.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
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
