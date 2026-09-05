CREATE TABLE "player_merges" (
	"id" serial PRIMARY KEY NOT NULL,
	"guest_player_name" varchar(255) NOT NULL,
	"target_player_id" integer NOT NULL,
	"merged_by_user_id" integer NOT NULL,
	"moved_registration_ids" text NOT NULL,
	"moved_team_assignment_ids" text NOT NULL,
	"moved_stat_ids" text NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_merges" ADD CONSTRAINT "player_merges_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_merges" ADD CONSTRAINT "player_merges_merged_by_user_id_users_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_player";