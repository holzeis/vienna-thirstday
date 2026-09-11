ALTER TABLE "player_merges" ADD COLUMN "guest_player_id" integer;--> statement-breakpoint
ALTER TABLE "player_merges" ADD COLUMN "season" integer;--> statement-breakpoint
ALTER TABLE "player_merges" ADD CONSTRAINT "player_merges_guest_player_id_players_id_fk" FOREIGN KEY ("guest_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;