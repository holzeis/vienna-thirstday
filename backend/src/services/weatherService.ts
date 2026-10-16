import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { config } from "../config";
import { gamedayWeather } from "../db/schema";
import { isWindy, summarizeWindow, type HourlySlice, type WeatherSummary } from "../utils/weather";
import { localDateAndHour } from "../utils/timezone";

/**
 * Weather per gameday, from Open-Meteo (free, no API key). The same row
 * holds a FORECAST while the match is ahead and the OBSERVED conditions once
 * it's been played, so one query serves both "what to expect" and "what it
 * was like".
 *
 * Like gameday status (docs/ARCHITECTURE.md #3) this is refreshed lazily on
 * read rather than by a scheduled job: reading a gameday finds out whether
 * its snapshot is stale and refreshes it. The list endpoint does that
 * fire-and-forget (it must stay fast and never fail on a third-party
 * outage; history backfills a few rows per poll), the detail endpoint
 * awaits it with a short timeout so an opened matchday is current.
 */

const LEAGUE_TIMEZONE = "Europe/Vienna";
/** How long a match is assumed to run from kickoff - the window the weather is summarized over. */
export const PLAY_HOURS = 3;
/** Open-Meteo forecasts reach 16 days ahead; beyond that there is nothing honest to show. */
export const FORECAST_HORIZON_DAYS = 15;
/** Forecasts drift as the day approaches; refreshing every few hours is plenty without hammering the API. */
export const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;
/** After a failed fetch, wait before trying that gameday again (list polling is every 30s). */
const RETRY_BACKOFF_MS = 5 * 60 * 1000;
/** The forecast API serves ~3 months of past days; older dates need the (lagging) archive API. */
const FORECAST_API_PAST_DAYS = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

type WeatherRow = typeof gamedayWeather.$inferSelect;
type KindToFetch = "FORECAST" | "OBSERVED";

/**
 * Decides whether a gameday's stored weather needs (re)fetching, and as
 * which kind. Pure so the staleness rules are unit-testable.
 * - an OBSERVED row for the current kickoff is final: never refetched
 * - after the match window ends: fetch what actually happened
 * - before it: (re)fetch a forecast if missing, for a moved kickoff, or older
 *   than the TTL - but only inside the provider's forecast horizon
 */
export function planWeatherRefresh(
  gameday: { date: Date },
  existing: Pick<WeatherRow, "kind" | "forDate" | "fetchedAt"> | null | undefined,
  now: Date = new Date()
): KindToFetch | null {
  const sameKickoff = existing && existing.forDate.getTime() === gameday.date.getTime();
  if (sameKickoff && existing.kind === "OBSERVED") return null;

  const matchOver = now.getTime() >= gameday.date.getTime() + PLAY_HOURS * 60 * 60 * 1000;
  if (matchOver) return "OBSERVED";

  if (gameday.date.getTime() - now.getTime() > FORECAST_HORIZON_DAYS * DAY_MS) return null;
  if (sameKickoff && now.getTime() - existing.fetchedAt.getTime() < FORECAST_TTL_MS) return null;
  return "FORECAST";
}

export function buildWeatherUrl(date: Date, now: Date = new Date()): string {
  const { date: day } = localDateAndHour(date, LEAGUE_TIMEZONE);
  const ageDays = (now.getTime() - date.getTime()) / DAY_MS;
  const base = ageDays > FORECAST_API_PAST_DAYS ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const params = new URLSearchParams({
    latitude: String(config.weatherLatitude),
    longitude: String(config.weatherLongitude),
    hourly: "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m",
    timezone: LEAGUE_TIMEZONE,
    start_date: day,
    end_date: day,
    wind_speed_unit: "kmh",
  });
  return `${base}?${params}`;
}

/** Turns an Open-Meteo hourly response into a summary of the playing window, or null if it has no data for that window. */
export function parseOpenMeteo(body: any, kickoff: Date): WeatherSummary | null {
  const hourly = body?.hourly;
  if (!hourly?.time) return null;
  const { date: day, hour } = localDateAndHour(kickoff, LEAGUE_TIMEZONE);
  const startIndex = (hourly.time as string[]).indexOf(`${day}T${String(hour).padStart(2, "0")}:00`);
  if (startIndex < 0) return null;
  const slice: HourlySlice = {
    temperature: hourly.temperature_2m ?? [],
    apparentTemperature: hourly.apparent_temperature ?? [],
    precipitation: hourly.precipitation ?? [],
    precipitationProbability: hourly.precipitation_probability ?? [],
    weatherCode: hourly.weather_code ?? [],
    windSpeed: hourly.wind_speed_10m ?? [],
    windGusts: hourly.wind_gusts_10m ?? [],
  };
  return summarizeWindow(slice, startIndex, PLAY_HOURS);
}

/** Fetches and stores (upserts) weather for one gameday. Throws on network/HTTP failure; resolves quietly if the provider has no data yet. */
export async function refreshGamedayWeather(
  gameday: { id: number; date: Date },
  kind: KindToFetch,
  opts: { timeoutMs?: number } = {}
): Promise<void> {
  const res = await fetch(buildWeatherUrl(gameday.date), { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
  const summary = parseOpenMeteo(await res.json(), gameday.date);
  if (!summary) return;

  const values = {
    gamedayId: gameday.id,
    kind,
    forDate: gameday.date,
    ...summary,
    // Probability only exists for forecasts; observed rows have none.
    precipitationProbability: kind === "FORECAST" ? summary.precipitationProbability : null,
    fetchedAt: new Date(),
  };
  await db.insert(gamedayWeather).values(values).onConflictDoUpdate({ target: gamedayWeather.gamedayId, set: values });
}

const inFlight = new Set<number>();
const lastFailure = new Map<number, number>();

/**
 * Refreshes whichever of `gamedays` have stale weather, sequentially (gentle on the
 * provider's free tier) and never throwing: a provider outage just
 * leaves the old snapshot in place. In-flight + failure-backoff tracking is
 * per process, which is enough - a duplicate fetch from another replica is
 * harmless because the write is an idempotent upsert.
 */
export async function refreshStaleWeather(
  gamedays: { id: number; date: Date }[],
  weatherByGamedayId: Map<number, WeatherRow>,
  opts: { timeoutMs?: number } = {}
): Promise<void> {
  if (!config.weatherEnabled) return;
  for (const g of gamedays) {
    const kind = planWeatherRefresh(g, weatherByGamedayId.get(g.id));
    if (!kind || inFlight.has(g.id)) continue;
    if (Date.now() - (lastFailure.get(g.id) ?? 0) < RETRY_BACKOFF_MS) continue;
    inFlight.add(g.id);
    try {
      await refreshGamedayWeather(g, kind, opts);
      lastFailure.delete(g.id);
    } catch (err) {
      lastFailure.set(g.id, Date.now());
      console.error(`Weather refresh failed for gameday ${g.id}:`, err instanceof Error ? err.message : err);
    } finally {
      inFlight.delete(g.id);
    }
  }
}

export async function loadWeather(gamedayId: number): Promise<WeatherRow | undefined> {
  const [row] = await db.select().from(gamedayWeather).where(eq(gamedayWeather.gamedayId, gamedayId));
  return row;
}

/** API shape. A row for a since-moved kickoff is hidden rather than shown wrong. */
export function toWeatherView(row: WeatherRow | undefined | null, gameday: { date: Date }) {
  if (!row || row.forDate.getTime() !== gameday.date.getTime()) return null;
  return {
    kind: row.kind,
    condition: row.condition,
    temperatureC: row.temperatureC,
    feelsLikeC: row.feelsLikeC,
    windSpeedKmh: row.windSpeedKmh,
    windGustsKmh: row.windGustsKmh,
    isWindy: isWindy(row.windSpeedKmh, row.windGustsKmh),
    precipitationMm: row.precipitationMm,
    precipitationProbability: row.precipitationProbability,
    fetchedAt: row.fetchedAt,
  };
}
