ALTER TABLE "players" ADD COLUMN "avatar_data" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "avatar_mime_type" varchar(100);--> statement-breakpoint
ALTER TABLE "gamedays" DROP COLUMN "location";