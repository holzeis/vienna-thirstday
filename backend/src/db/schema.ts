// Vienna Thirstday Kicken - Drizzle schema
//
// Domain model:
// - users: login account (email/password, JWT auth), roles, approval workflow
// - players: anyone who can appear on a gameday roster (a registered user's profile OR a guest)
// - gamedays: a single Thursday session, capacity-limited with a waitlist
// - registrations: a player's signup for a gameday (confirmed / waitlisted / cancelled)
// - team_assignments: which team (A/B) a player is on for a given gameday
// - results: final score for a gameday
// - player_gameday_stats: computed points/goal-diff snapshot per player per gameday (feeds season standings)

import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const gamedayStatusEnum = pgEnum("gameday_status", ["OPEN", "CLOSED", "CANCELLED", "COMPLETED"]);
export const registrationStatusEnum = pgEnum("registration_status", ["CONFIRMED", "WAITLISTED", "CANCELLED"]);
export const teamEnum = pgEnum("team", ["A", "B"]);
export const accessEventTypeEnum = pgEnum("access_event_type", ["LOGIN", "GUEST_REGISTER", "APP_OPEN"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  // Optional contact info only - not used for login. A user row is only
  // ever created fully-formed by accepting an invite (routes/invites.ts),
  // so there's no pending/approval state to track here.
  email: varchar("email", { length: 255 }).unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  playerId: integer("player_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    isGuest: boolean("is_guest").notNull().default(false),
    addedByUserId: integer("added_by_user_id").references(() => users.id),
    avatarData: text("avatar_data"),
    avatarMimeType: varchar("avatar_mime_type", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    addedByIdx: index("players_added_by_idx").on(t.addedByUserId),
  })
);

export const gamedays = pgTable(
  "gamedays",
  {
    id: serial("id").primaryKey(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    minPlayers: integer("min_players").notNull().default(8),
    maxPlayers: integer("max_players").notNull().default(14),
    status: gamedayStatusEnum("status").notNull().default("OPEN"),
    notes: text("notes"),
    // Long, unguessable token for the public "share this matchday" link
    // (routes/gamedayShare.ts) - lets someone without an account sign up as
    // a guest, or a registered player log in and register themselves,
    // without exposing the authenticated gameday detail view (registrant
    // emails, admin team/result controls) to anyone holding the link.
    // Nullable because it's generated lazily on first request, not at
    // gameday creation - most gamedays are never shared.
    shareToken: varchar("share_token", { length: 64 }).unique(),
    // Nullable, ON DELETE SET NULL: deleting the admin who created this
    // gameday must never be blocked by, or destroy, real game history - see
    // routes/adminUsers.ts's DELETE /:id.
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index("gamedays_date_idx").on(t.date),
  })
);

export const registrations = pgTable(
  "registrations",
  {
    id: serial("id").primaryKey(),
    gamedayId: integer("gameday_id")
      .notNull()
      .references(() => gamedays.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    status: registrationStatusEnum("status").notNull().default("CONFIRMED"),
    signupAt: timestamp("signup_at", { withTimezone: true }).notNull().defaultNow(),
    // Nullable, ON DELETE SET NULL: who performed the sign-up is separate
    // from who it's for (playerId) - deleting that user's account must
    // never delete or block deleting someone else's registration.
    registeredByUserId: integer("registered_by_user_id").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // Set only when a guest registers via the public matchday share link
    // (gamedayShare.ts) - a random secret (same generator as invite/share
    // tokens) returned once in that response and required to self-cancel
    // through the same link. Necessary because playerId alone is not a
    // secret there (it's derivable from the public roster/status lookup),
    // so it can't be trusted to authorize cancelling someone else's spot.
    // Null for registrations made any other way (authenticated players
    // cancel via the JWT-gated route instead, which checks
    // registeredByUserId).
    cancelToken: text("cancel_token"),
  },
  (t) => ({
    gamedayPlayerUnique: uniqueIndex("registrations_gameday_player_unique").on(t.gamedayId, t.playerId),
    lookupIdx: index("registrations_lookup_idx").on(t.gamedayId, t.status, t.signupAt),
  })
);

export const teamAssignments = pgTable(
  "team_assignments",
  {
    id: serial("id").primaryKey(),
    gamedayId: integer("gameday_id")
      .notNull()
      .references(() => gamedays.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    team: teamEnum("team").notNull(),
  },
  (t) => ({
    gamedayPlayerUnique: uniqueIndex("team_assignments_gameday_player_unique").on(t.gamedayId, t.playerId),
  })
);

export const results = pgTable("results", {
  id: serial("id").primaryKey(),
  gamedayId: integer("gameday_id")
    .notNull()
    .unique()
    .references(() => gamedays.id, { onDelete: "cascade" }),
  teamAScore: integer("team_a_score").notNull(),
  teamBScore: integer("team_b_score").notNull(),
  // Nullable, ON DELETE SET NULL - same reasoning as gamedays.createdByUserId.
  enteredByUserId: integer("entered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playerGamedayStats = pgTable(
  "player_gameday_stats",
  {
    id: serial("id").primaryKey(),
    resultId: integer("result_id")
      .notNull()
      .references(() => results.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    team: teamEnum("team").notNull(),
    points: integer("points").notNull(),
    goalDiff: integer("goal_diff").notNull(),
  },
  (t) => ({
    resultPlayerUnique: uniqueIndex("player_gameday_stats_result_player_unique").on(t.resultId, t.playerId),
    playerIdx: index("player_gameday_stats_player_idx").on(t.playerId),
  })
);

/**
 * Admin-issued onboarding links. There is no self-service registration -
 * this is the only way to create an account. Two kinds, told apart by
 * whether guestPlayerId is set:
 *  - Guest-linked: starts from an existing guest player, promoted
 *    (isGuest -> false) the moment the invite is created. Single-use -
 *    usedAt/usedByUserId are set on accept and gate a second attempt. Whoever
 *    opens the link confirms/changes that player's name, so the resulting
 *    account keeps the guest's full history with nothing to merge.
 *  - Open (guestPlayerId null): no guest, no history - accepting one creates
 *    a brand-new player from scratch. Reusable - usedAt is never set, so the
 *    link keeps working (until expiry/revocation) for as many people as
 *    accept it. An admin can attach a guest's history to the resulting
 *    account afterward via the ordinary merge tool (playerMergeService.ts).
 * Every acceptance of either kind is logged to inviteRedemptions, which is
 * what lets the admin page show who joined via a given link. The token is
 * the only credential needed to onboard, so it's a long random string (see
 * utils/inviteToken.ts) rather than anything guessable. Kept in plaintext
 * (not hashed) so an admin can re-open the "Invites" list and copy a
 * still-pending link again without having to regenerate it.
 */
export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    note: varchar("note", { length: 255 }),
    guestPlayerId: integer("guest_player_id").references(() => players.id, { onDelete: "cascade" }),
    // Nullable, ON DELETE SET NULL - deleting the admin who issued or
    // accepted an invite must never be blocked by, or destroy, that invite.
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByUserId: integer("used_by_user_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdByIdx: index("invites_created_by_idx").on(t.createdByUserId),
  })
);

/**
 * One row per successful invite acceptance - for a guest-linked (single-use)
 * invite there will only ever be one, but an open invite can rack up many.
 * userId/playerId are nullable with ON DELETE SET NULL (same convention as
 * accessEvents) so deleting the account later never deletes this history,
 * only the live link; playerName is a snapshot for the same reason.
 */
export const inviteRedemptions = pgTable(
  "invite_redemptions",
  {
    id: serial("id").primaryKey(),
    inviteId: integer("invite_id")
      .notNull()
      .references(() => invites.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    playerId: integer("player_id").references(() => players.id, { onDelete: "set null" }),
    playerName: varchar("player_name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inviteIdx: index("invite_redemptions_invite_idx").on(t.inviteId),
  })
);

/**
 * A browser/device's Web Push subscription (one row per PushSubscription
 * object the frontend registers via the service worker). A user can have
 * several - one per device/browser they've enabled notifications on.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("push_subscriptions_user_idx").on(t.userId),
  })
);

/**
 * Audit log for guest-into-player merges (playerMergeService). A merge can
 * be scoped to one `season` (year) rather than the guest's whole history -
 * in that case the guest keeps whatever's left of their other seasons and
 * is *not* deleted, so `guestPlayerId` is captured (nullable, ON DELETE SET
 * NULL) to let `undoPlayerMerge` move rows straight back onto that same
 * still-alive guest instead of recreating one. Once a guest is fully
 * drained (this merge or a later one covers every season they had) it's
 * deleted like before, which naturally nulls out `guestPlayerId` on every
 * merge log row that ever referenced it - `guestPlayerName` is the
 * fallback undo uses once that happens, since the row itself is gone. The
 * moved-row id lists (JSON arrays of registration/team-assignment/gameday-
 * stat ids) are what makes `undoPlayerMerge` possible either way.
 */
export const playerMerges = pgTable("player_merges", {
  id: serial("id").primaryKey(),
  guestPlayerName: varchar("guest_player_name", { length: 255 }).notNull(),
  guestPlayerId: integer("guest_player_id").references(() => players.id, { onDelete: "set null" }),
  // Null = the whole guest's history was merged; otherwise the calendar
  // year this merge was scoped to.
  season: integer("season"),
  targetPlayerId: integer("target_player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  // Nullable, ON DELETE SET NULL - deleting the admin who performed a merge
  // must never be blocked by, or destroy, that audit log entry.
  mergedByUserId: integer("merged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  movedRegistrationIds: text("moved_registration_ids").notNull(),
  movedTeamAssignmentIds: text("moved_team_assignment_ids").notNull(),
  movedStatIds: text("moved_stat_ids").notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Usage metrics, meant to be queried directly (e.g. from Metabase) rather
 * than through the app - so this deliberately denormalizes playerName/isGuest
 * onto the row instead of requiring a join, and keeps the raw userAgent
 * string alongside the parsed os/browser/deviceType so a misclassification
 * can be re-examined later. One row per LOGIN (routes/auth.ts, only fires on
 * an actual credentials submit - not while a cached JWT is still valid),
 * GUEST_REGISTER (routes/gamedayShare.ts), or APP_OPEN (routes/auth.ts's
 * GET /me, called once per app load/PWA launch regardless of whether the
 * token needed refreshing - this is the "how often is the app actually
 * used" signal, distinct from LOGIN) event - not a full page-view log.
 */
export const accessEvents = pgTable(
  "access_events",
  {
    id: serial("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    eventType: accessEventTypeEnum("event_type").notNull(),
    isGuest: boolean("is_guest").notNull(),
    // Nullable + onDelete:set null so removing a player later never deletes
    // the historical metrics row it's referenced from, only the live link.
    playerId: integer("player_id").references(() => players.id, { onDelete: "set null" }),
    playerName: varchar("player_name", { length: 255 }).notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    os: varchar("os", { length: 32 }).notNull(),
    browser: varchar("browser", { length: 32 }).notNull(),
    deviceType: varchar("device_type", { length: 16 }).notNull(),
    // Null (not false) when the client didn't send the standalone-mode
    // header at all, e.g. an older cached frontend build - distinct from a
    // real "opened in a browser tab" false.
    isPwa: boolean("is_pwa"),
    userAgent: text("user_agent"),
  },
  (t) => ({
    occurredAtIdx: index("access_events_occurred_at_idx").on(t.occurredAt),
    playerIdx: index("access_events_player_idx").on(t.playerId),
  })
);

// ---- relations (for query API ergonomics) ----

export const usersRelations = relations(users, ({ one, many }) => ({
  player: one(players, { fields: [users.playerId], references: [players.id] }),
  guestsCreated: many(players, { relationName: "guestOwner" }),
  registrationsMade: many(registrations),
  gamedaysCreated: many(gamedays),
  resultsEntered: many(results),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  addedBy: one(users, { fields: [players.addedByUserId], references: [users.id], relationName: "guestOwner" }),
  registrations: many(registrations),
  teamAssignments: many(teamAssignments),
  gamedayStats: many(playerGamedayStats),
}));

export const gamedaysRelations = relations(gamedays, ({ one, many }) => ({
  createdBy: one(users, { fields: [gamedays.createdByUserId], references: [users.id] }),
  registrations: many(registrations),
  teamAssignments: many(teamAssignments),
  result: one(results, { fields: [gamedays.id], references: [results.gamedayId] }),
}));

export const registrationsRelations = relations(registrations, ({ one }) => ({
  gameday: one(gamedays, { fields: [registrations.gamedayId], references: [gamedays.id] }),
  player: one(players, { fields: [registrations.playerId], references: [players.id] }),
  registeredBy: one(users, { fields: [registrations.registeredByUserId], references: [users.id] }),
}));

export const teamAssignmentsRelations = relations(teamAssignments, ({ one }) => ({
  gameday: one(gamedays, { fields: [teamAssignments.gamedayId], references: [gamedays.id] }),
  player: one(players, { fields: [teamAssignments.playerId], references: [players.id] }),
}));

export const resultsRelations = relations(results, ({ one, many }) => ({
  gameday: one(gamedays, { fields: [results.gamedayId], references: [gamedays.id] }),
  enteredBy: one(users, { fields: [results.enteredByUserId], references: [users.id] }),
  playerStats: many(playerGamedayStats),
}));

export const playerGamedayStatsRelations = relations(playerGamedayStats, ({ one }) => ({
  result: one(results, { fields: [playerGamedayStats.resultId], references: [results.id] }),
  player: one(players, { fields: [playerGamedayStats.playerId], references: [players.id] }),
}));

export const playerMergesRelations = relations(playerMerges, ({ one }) => ({
  targetPlayer: one(players, { fields: [playerMerges.targetPlayerId], references: [players.id] }),
  mergedBy: one(users, { fields: [playerMerges.mergedByUserId], references: [users.id] }),
}));

export const invitesRelations = relations(invites, ({ one, many }) => ({
  guestPlayer: one(players, { fields: [invites.guestPlayerId], references: [players.id] }),
  createdBy: one(users, { fields: [invites.createdByUserId], references: [users.id] }),
  usedBy: one(users, { fields: [invites.usedByUserId], references: [users.id] }),
  redemptions: many(inviteRedemptions),
}));

export const inviteRedemptionsRelations = relations(inviteRedemptions, ({ one }) => ({
  invite: one(invites, { fields: [inviteRedemptions.inviteId], references: [invites.id] }),
  user: one(users, { fields: [inviteRedemptions.userId], references: [users.id] }),
  player: one(players, { fields: [inviteRedemptions.playerId], references: [players.id] }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));

export const accessEventsRelations = relations(accessEvents, ({ one }) => ({
  player: one(players, { fields: [accessEvents.playerId], references: [players.id] }),
  user: one(users, { fields: [accessEvents.userId], references: [users.id] }),
}));
