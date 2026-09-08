import "./testDb";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { db } from "../db/client";
import { players, users } from "../db/schema";
import { resetDb, closeDb, createAdmin, createGuestPlayer } from "./helpers";

const app = createApp();

beforeEach(resetDb);
afterAll(closeDb);

async function loginAs(name: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.body.token as string;
}

describe("GET /guests", () => {
  it("lists only guests, never an account-linked player", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    await createGuestPlayer("Robert");

    const res = await request(app).get("/api/guests").set("Authorization", `Bearer ${token}`);
    const names = res.body.guests.map((g: any) => g.name);
    expect(names).toContain("Robert");
    expect(names).not.toContain("Admin");
  });

  it("no longer lists a guest once they've been promoted via a guest-linked invite", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");
    await request(app).post("/api/admin/invites").set("Authorization", `Bearer ${token}`).send({ guestPlayerId: guest.id });

    const res = await request(app).get("/api/guests").set("Authorization", `Bearer ${token}`);
    expect(res.body.guests.map((g: any) => g.name)).not.toContain("Robert");
  });
});

describe("POST /guests", () => {
  it("creates a new guest", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);

    const res = await request(app).post("/api/guests").set("Authorization", `Bearer ${token}`).send({ name: "Robert" });
    expect(res.status).toBe(201);
    expect(res.body.guest.name).toBe("Robert");
    expect(res.body.guest.isGuest).toBe(true);
  });

  it("finds an existing guest by case-insensitive name instead of duplicating", async () => {
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const guest = await createGuestPlayer("Robert");

    const res = await request(app).post("/api/guests").set("Authorization", `Bearer ${token}`).send({ name: "robert" });
    expect(res.status).toBe(200);
    expect(res.body.guest.id).toBe(guest.id);
  });

  it("refuses to create a guest whose name already belongs to an account-linked player", async () => {
    const { password } = await createAdmin("Robert");
    const token = await loginAs("Robert", password);

    const res = await request(app).post("/api/guests").set("Authorization", `Bearer ${token}`).send({ name: "Robert" });
    expect(res.status).toBe(409);

    const guests = await db.query.players.findMany({ where: eq(players.isGuest, true) });
    expect(guests).toHaveLength(0);
  });

  it("still refuses for a name that only differs by case from an account-linked player", async () => {
    await createAdmin("Robert");
    const { password } = await createAdmin("Other");
    const token = await loginAs("Other", password);

    const res = await request(app).post("/api/guests").set("Authorization", `Bearer ${token}`).send({ name: "ROBERT" });
    expect(res.status).toBe(409);
  });

  it("still allows a guest that shares a name with a player who was later deleted", async () => {
    // Sanity check that the guard is scoped to *currently* account-linked
    // players, not every name that ever existed.
    const { password } = await createAdmin("Admin");
    const token = await loginAs("Admin", password);
    const otherHash = "x";
    const [otherPlayer] = await db.insert(players).values({ name: "Robert", isGuest: false }).returning();
    const [otherUser] = await db.insert(users).values({ passwordHash: otherHash, isAdmin: false, playerId: otherPlayer.id }).returning();
    await request(app).delete(`/api/admin/users/${otherUser.id}`).set("Authorization", `Bearer ${token}`);
    // Deleting the user reverts the player to a guest (see adminUsers.ts) -
    // so "Robert" is findable as an existing guest, not blocked as a collision.
    const res = await request(app).post("/api/guests").set("Authorization", `Bearer ${token}`).send({ name: "Robert" });
    expect(res.status).toBe(200);
    expect(res.body.guest.id).toBe(otherPlayer.id);
  });
});
