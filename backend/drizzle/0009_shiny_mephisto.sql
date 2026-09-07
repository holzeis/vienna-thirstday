ALTER TABLE "gamedays" DROP CONSTRAINT "gamedays_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_used_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "player_merges" DROP CONSTRAINT "player_merges_merged_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_registered_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "results" DROP CONSTRAINT "results_entered_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "gamedays" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "player_merges" ALTER COLUMN "merged_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "registered_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "entered_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gamedays" ADD CONSTRAINT "gamedays_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_merges" ADD CONSTRAINT "player_merges_merged_by_user_id_users_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;