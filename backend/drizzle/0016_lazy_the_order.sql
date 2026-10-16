ALTER TABLE "invites" DROP CONSTRAINT "invites_guest_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "season" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_guest_player_id_players_id_fk" FOREIGN KEY ("guest_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;