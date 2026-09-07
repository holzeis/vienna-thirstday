import type { Request } from "express";
import { db } from "../db/client";
import { accessEvents } from "../db/schema";
import { parseUserAgent } from "../utils/userAgent";

interface RecordAccessEventInput {
  req: Request;
  eventType: "LOGIN" | "GUEST_REGISTER" | "APP_OPEN";
  isGuest: boolean;
  playerId: number | null;
  playerName: string;
  userId: number | null;
}

/**
 * Logs one row to access_events for a usage-metrics dashboard (Metabase or
 * similar) to query directly - see db/schema.ts's accessEvents for why the
 * table looks the way it does. Awaited by callers, unlike the push-service
 * fire-and-forget helpers: those are justified by a real network round-trip
 * per subscriber, but this is a single local insert on the same database
 * the request is already using - negligible latency, and awaiting it means
 * the row is guaranteed persisted before the response goes out (no silent
 * loss if the process dies right after responding).
 *
 * The frontend sends an X-Standalone header (see api/client.ts) on every
 * request once it's determined display-mode client-side - not knowable
 * from the User-Agent alone. Its absence (an older cached build, or a
 * request from something other than the app itself) is recorded as
 * "unknown" (null), distinct from a real "opened in a browser tab" (false).
 * Never throws - a metrics-logging failure must never fail the request it's
 * attached to.
 */
export async function recordAccessEvent(input: RecordAccessEventInput): Promise<void> {
  const userAgent = (input.req.headers["user-agent"] as string | undefined) ?? null;
  const { os, browser, deviceType } = parseUserAgent(userAgent);

  const standaloneHeader = input.req.headers["x-standalone"];
  const isPwa = standaloneHeader === undefined ? null : standaloneHeader === "1" || standaloneHeader === "true";

  try {
    await db.insert(accessEvents).values({
      eventType: input.eventType,
      isGuest: input.isGuest,
      playerId: input.playerId,
      playerName: input.playerName,
      userId: input.userId,
      os,
      browser,
      deviceType,
      isPwa,
      userAgent,
    });
  } catch (err) {
    console.error("recordAccessEvent failed:", err);
  }
}
