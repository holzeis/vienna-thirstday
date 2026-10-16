CREATE TYPE "public"."weather_kind" AS ENUM('FORECAST', 'OBSERVED');--> statement-breakpoint
CREATE TABLE "gameday_weather" (
	"id" serial PRIMARY KEY NOT NULL,
	"gameday_id" integer NOT NULL,
	"kind" "weather_kind" NOT NULL,
	"for_date" timestamp with time zone NOT NULL,
	"temperature_c" real NOT NULL,
	"feels_like_c" real,
	"wind_speed_kmh" real NOT NULL,
	"wind_gusts_kmh" real,
	"precipitation_mm" real DEFAULT 0 NOT NULL,
	"precipitation_probability" integer,
	"condition" varchar(16) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gameday_weather_gameday_id_unique" UNIQUE("gameday_id")
);
--> statement-breakpoint
ALTER TABLE "gameday_weather" ADD CONSTRAINT "gameday_weather_gameday_id_gamedays_id_fk" FOREIGN KEY ("gameday_id") REFERENCES "public"."gamedays"("id") ON DELETE cascade ON UPDATE no action;