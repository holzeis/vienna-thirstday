// Vienna Thursday Kicken - Drizzle schema
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

export const userStatusEnum = pgEnum("user_status", ["PENDING", "APPROVED", "REJECTED"]);
export const gamedayStatusEnum = pgEnum("gameday_status", ["OPEN", "CLOSED", "CANCELLED", "COMPLETED"]);
export const registrationStatusEnum = pgEnum("registration_status", ["CONFIRMED", "WAITLISTED", "CANCELLED"]);
export const teamEnum = pgEnum("team", ["A", "B"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  status: userStatusEnum("status").notNull().default("PENDING"),
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
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id),
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
    registeredByUserId: integer("registered_by_user_id")
      .notNull()
      .references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
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
  enteredByUserId: integer("entered_by_user_id")
    .notNull()
    .references(() => users.id),
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
 * Audit log for guest-into-player merges (playerMergeService). The guest
 * player row is deleted once merged, so its name is captured here; the
 * moved-row id lists (JSON arrays of registration/team-assignment/gameday-
 * stat ids) are what makes `undoPlayerMerge` possible - reversing a merge
 * means recreating the guest and pointing exactly those rows back at it.
 */
export const playerMerges = pgTable("player_merges", {
  id: serial("id").primaryKey(),
  guestPlayerName: varchar("guest_player_name", { length: 255 }).notNull(),
  targetPlayerId: integer("target_player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  mergedByUserId: integer("merged_by_user_id")
    .notNull()
    .references(() => users.id),
  movedRegistrationIds: text("moved_registration_ids").notNull(),
  movedTeamAssignmentIds: text("moved_team_assignment_ids").notNull(),
  movedStatIds: text("moved_stat_ids").notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
