CREATE TYPE "public"."gameday_status" AS ENUM('OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('CONFIRMED', 'WAITLISTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."team" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "gamedays" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"location" varchar(255),
	"min_players" integer DEFAULT 8 NOT NULL,
	"max_players" integer DEFAULT 14 NOT NULL,
	"status" "gameday_status" DEFAULT 'OPEN' NOT NULL,
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_gameday_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"result_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"team" "team" NOT NULL,
	"points" integer NOT NULL,
	"goal_diff" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_guest" boolean DEFAULT false NOT NULL,
	"added_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"gameday_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"status" "registration_status" DEFAULT 'CONFIRMED' NOT NULL,
	"signup_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_by_user_id" integer NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" serial PRIMARY KEY NOT NULL,
	"gameday_id" integer NOT NULL,
	"team_a_score" integer NOT NULL,
	"team_b_score" integer NOT NULL,
	"entered_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_gameday_id_unique" UNIQUE("gameday_id")
);
--> statement-breakpoint
CREATE TABLE "team_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"gameday_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"team" "team" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"status" "user_status" DEFAULT 'PENDING' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_player" boolean DEFAULT true NOT NULL,
	"player_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
ALTER TABLE "gamedays" ADD CONSTRAINT "gamedays_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_gameday_stats" ADD CONSTRAINT "player_gameday_stats_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_gameday_stats" ADD CONSTRAINT "player_gameday_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_gameday_id_gamedays_id_fk" FOREIGN KEY ("gameday_id") REFERENCES "public"."gamedays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_gameday_id_gamedays_id_fk" FOREIGN KEY ("gameday_id") REFERENCES "public"."gamedays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_assignments" ADD CONSTRAINT "team_assignments_gameday_id_gamedays_id_fk" FOREIGN KEY ("gameday_id") REFERENCES "public"."gamedays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_assignments" ADD CONSTRAINT "team_assignments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gamedays_date_idx" ON "gamedays" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "player_gameday_stats_result_player_unique" ON "player_gameday_stats" USING btree ("result_id","player_id");--> statement-breakpoint
CREATE INDEX "player_gameday_stats_player_idx" ON "player_gameday_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "players_added_by_idx" ON "players" USING btree ("added_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_gameday_player_unique" ON "registrations" USING btree ("gameday_id","player_id");--> statement-breakpoint
CREATE INDEX "registrations_lookup_idx" ON "registrations" USING btree ("gameday_id","status","signup_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_assignments_gameday_player_unique" ON "team_assignments" USING btree ("gameday_id","player_id");