import webpush from "web-push";
import { eq } from "drizzle-orm";
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
 * Sends `payload` to every stored subscription. A subscription the push
 * service reports as gone (404/410 - the browser unsubscribed or the
 * endpoint expired) is pruned so it stops being retried forever. Never
 * throws - a delivery failure shouldn't fail whatever action triggered it.
 */
export async function sendPushToAll(db: DbOrTx, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;

  const subs = await db.query.pushSubscriptions.findMany();
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

/** Notifies every subscribed device that a new gameday has been posted. */
export async function notifyNewGameday(db: DbOrTx, gameday: { id: number; date: Date }): Promise<void> {
  const dateLabel = gameday.date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Vienna",
  });
  await sendPushToAll(db, {
    title: "New matchday posted",
    body: `${dateLabel} - sign up now.`,
    url: `/gamedays/${gameday.id}`,
  });
}
