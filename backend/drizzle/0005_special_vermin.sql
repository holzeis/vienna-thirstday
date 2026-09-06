ALTER TABLE "gamedays" ADD COLUMN "share_token" varchar(64);--> statement-breakpoint
ALTER TABLE "gamedays" ADD CONSTRAINT "gamedays_share_token_unique" UNIQUE("share_token");