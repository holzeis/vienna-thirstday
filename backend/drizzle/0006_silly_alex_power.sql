CREATE TYPE "public"."access_event_type" AS ENUM('LOGIN', 'GUEST_REGISTER');--> statement-breakpoint
CREATE TABLE "access_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" "access_event_type" NOT NULL,
	"is_guest" boolean NOT NULL,
	"player_id" integer,
	"player_name" varchar(255) NOT NULL,
	"user_id" integer,
	"os" varchar(32) NOT NULL,
	"browser" varchar(32) NOT NULL,
	"device_type" varchar(16) NOT NULL,
	"is_pwa" boolean,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_events_occurred_at_idx" ON "access_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "access_events_player_idx" ON "access_events" USING btree ("player_id");