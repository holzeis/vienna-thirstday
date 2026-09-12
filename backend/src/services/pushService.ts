import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { config } from "../config";

type DbOrTx = NodePgDatabase<typeof schema>;

let configured = false;

/** Lazily configures web-push the first time it's actually needed - lets a deployment run with push disabled by simply not setting the VAPID env vars. */
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return false;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Sends `payload` to every subscription in `subs`. A subscription the push
 * service reports as gone (404/410 - the browser unsubscribed or the
 * endpoint expired) is pruned so it stops being retried forever. Never
 * throws - a delivery failure shouldn't fail whatever action triggered it.
 */
async function deliver(db: DbOrTx, subs: (typeof schema.pushSubscriptions.$inferSelect)[], payload: PushPayload): Promise<void> {
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
        } else {
          console.error("Push notification failed:", err instanceof Error ? err.message : err);
        }
      }
    })
  );
}

/** Sends `payload` to every stored subscription, regardless of user. */
export async function sendPushToAll(db: DbOrTx, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = await db.query.pushSubscriptions.findMany();
  await deliver(db, subs, payload);
}

/** Sends `payload` only to the given users' subscriptions. */
async function sendPushToUsers(db: DbOrTx, userIds: number[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured() || userIds.length === 0) return;
  const subs = await db.query.pushSubscriptions.findMany({ where: inArray(schema.pushSubscriptions.userId, userIds) });
  await deliver(db, subs, payload);
}

/** Resolves player ids to the user ids of whichever ones are claimed accounts - guests have no login/subscription to notify. */
async function userIdsForPlayers(db: DbOrTx, playerIds: number[]): Promise<number[]> {
  if (playerIds.length === 0) return [];
  const linked = await db.query.users.findMany({ where: inArray(schema.users.playerId, playerIds) });
  return linked.map((u) => u.id);
}

/** Sends `payload` to every admin's subscriptions. */
async function sendPushToAdmins(db: DbOrTx, payload: PushPayload): Promise<void> {
  const admins = await db.query.users.findMany({ where: eq(schema.users.isAdmin, true) });
  await sendPushToUsers(
    db,
    admins.map((a) => a.id),
    payload
  );
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Vienna",
  });
}

/** Notifies every subscribed device that a new gameday has been posted. */
export async function notifyNewGameday(db: DbOrTx, gameday: { id: number; date: Date }): Promise<void> {
  await sendPushToAll(db, {
    title: "New matchday posted",
    body: `${dateLabel(gameday.date)} - sign up now.`,
    url: `/gamedays/${gameday.id}`,
  });
}

/** Notifies every player (confirmed or waitlisted) that the gameday they signed up for has been cancelled. */
export async function notifyGamedayCancelled(db: DbOrTx, playerIds: number[], gameday: { id: number; date: Date }): Promise<void> {
  const userIds = await userIdsForPlayers(db, playerIds);
  await sendPushToUsers(db, userIds, {
    title: "Matchday cancelled",
    body: `${dateLabel(gameday.date)} has been cancelled.`,
    url: `/gamedays/${gameday.id}`,
  });
}

/** Notifies specific players (by player id) that they've been moved off the waitlist onto the confirmed list. */
export async function notifyPromotedFromWaitlist(db: DbOrTx, playerIds: number[], gameday: { id: number; date: Date }): Promise<void> {
  const userIds = await userIdsForPlayers(db, playerIds);
  await sendPushToUsers(db, userIds, {
    title: "You're in!",
    body: `A spot opened up - you're now confirmed for ${dateLabel(gameday.date)}.`,
    url: `/gamedays/${gameday.id}`,
  });
}

/** Notifies every admin that someone accepted an invite link (guest-linked or open) and joined as a player. */
export async function notifyAdminsInviteAccepted(db: DbOrTx, player: { name: string }): Promise<void> {
  await sendPushToAdmins(db, {
    title: "New player joined",
    body: `${player.name} just accepted an invite.`,
    url: "/admin/users",
  });
}

/**
 * Notifies a gameday's creator whenever someone signs up or cancels, so an
 * admin can keep an eye on attendance without refreshing the page. Looks up
 * the player's name and (for a signup) their resulting confirmed/waitlisted
 * status itself, since callers already have their hands full with their own
 * waitlist recompute - keeps every call site to one line. No-op if the
 * gameday's creator account was since deleted (createdByUserId nulled) or
 * the player id can't be resolved.
 */
export async function notifyCreatorOfRegistrationChange(
  db: DbOrTx,
  gameday: { id: number; date: Date; createdByUserId: number | null },
  playerId: number,
  kind: "signed_up" | "cancelled"
): Promise<void> {
  if (gameday.createdByUserId === null) return;
  const player = await db.query.players.findFirst({ where: eq(schema.players.id, playerId) });
  if (!player) return;

  let title: string;
  let body: string;
  if (kind === "signed_up") {
    const reg = await db.query.registrations.findFirst({
      where: (r, { and, eq }) => and(eq(r.gamedayId, gameday.id), eq(r.playerId, playerId)),
    });
    title = "New sign-up";
    body = `${player.name} just signed up for ${dateLabel(gameday.date)} - ${reg?.status === "WAITLISTED" ? "waitlisted" : "confirmed"}.`;
  } else {
    title = "Cancellation";
    body = `${player.name} just cancelled their spot for ${dateLabel(gameday.date)}.`;
  }

  await sendPushToUsers(db, [gameday.createdByUserId], { title, body, url: `/gamedays/${gameday.id}` });
}

/**
 * Notifies every currently-confirmed player for a gameday that it just
 * crossed the minimum-players line - `confirmed: true` once enough players
 * signed up for it to go ahead, `confirmed: false` if a cancellation just
 * dropped it back below that line.
 */
export async function notifyGameStatusChange(
  db: DbOrTx,
  gameday: { id: number; date: Date },
  confirmed: boolean
): Promise<void> {
  const confirmedRegs = await db.query.registrations.findMany({
    where: (r, { and, eq }) => and(eq(r.gamedayId, gameday.id), eq(r.status, "CONFIRMED")),
  });
  const userIds = await userIdsForPlayers(
    db,
    confirmedRegs.map((r) => r.playerId)
  );
  await sendPushToUsers(
    db,
    userIds,
    confirmed
      ? {
          title: "Matchday confirmed",
          body: `${dateLabel(gameday.date)} has enough players - the game is on!`,
          url: `/gamedays/${gameday.id}`,
        }
      : {
          title: "Matchday at risk",
          body: `${dateLabel(gameday.date)} just dropped below the minimum - it might not happen.`,
          url: `/gamedays/${gameday.id}`,
        }
  );
}
