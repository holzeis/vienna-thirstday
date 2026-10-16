/**
 * Pure weather helpers - no I/O, so the interpretation rules (what counts as
 * "windy", how a WMO code maps to a condition) are unit-testable on their
 * own. The network side lives in services/weatherService.ts.
 */

export type WeatherCondition = "sunny" | "cloudy" | "foggy" | "drizzle" | "rainy" | "snowy" | "stormy";

/** Mean 10m wind at or above this (km/h) is "windy" - roughly Beaufort 4, where a ball visibly starts to get pushed around. */
export const WINDY_THRESHOLD_KMH = 20;

export function isWindy(windSpeedKmh: number, windGustsKmh?: number | null): boolean {
  return windSpeedKmh >= WINDY_THRESHOLD_KMH || (windGustsKmh ?? 0) >= WINDY_THRESHOLD_KMH * 1.75;
}

/** Collapses a WMO weather interpretation code (as returned by Open-Meteo) into the handful of conditions we show. Unknown codes fall back to "cloudy". */
export function conditionFromWmoCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return "sunny";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowy";
  if (code >= 95) return "stormy";
  return "cloudy";
}

/** Higher = worse for playing outside; used to report the worst condition inside the playing window rather than just kickoff. */
const SEVERITY: Record<WeatherCondition, number> = {
  sunny: 0,
  cloudy: 1,
  foggy: 2,
  drizzle: 3,
  rainy: 4,
  snowy: 5,
  stormy: 6,
};

export interface HourlySlice {
  temperature: (number | null)[];
  apparentTemperature: (number | null)[];
  precipitation: (number | null)[];
  precipitationProbability: (number | null)[];
  weatherCode: (number | null)[];
  windSpeed: (number | null)[];
  windGusts: (number | null)[];
}

export interface WeatherSummary {
  temperatureC: number;
  feelsLikeC: number | null;
  windSpeedKmh: number;
  windGustsKmh: number | null;
  precipitationMm: number;
  precipitationProbability: number | null;
  condition: WeatherCondition;
}

const nums = (xs: (number | null)[]) => xs.filter((x): x is number => typeof x === "number");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Summarizes `hours` consecutive hourly entries starting at `startIndex`
 * (the playing window): mean temperature/wind, but *worst-case* rain, gusts,
 * rain probability and condition - one wet hour out of three still matters
 * for a match. Returns null when the provider has no data for the window
 * (e.g. a date beyond the forecast horizon comes back as nulls).
 */
export function summarizeWindow(h: HourlySlice, startIndex: number, hours: number): WeatherSummary | null {
  const end = startIndex + hours;
  const win = <T>(xs: T[]) => xs.slice(startIndex, end);
  const temps = nums(win(h.temperature));
  const winds = nums(win(h.windSpeed));
  if (temps.length === 0 || winds.length === 0) return null;

  const feels = nums(win(h.apparentTemperature));
  const gusts = nums(win(h.windGusts));
  const probs = nums(win(h.precipitationProbability));
  const codes = nums(win(h.weatherCode));
  const condition = codes.map(conditionFromWmoCode).reduce<WeatherCondition>((worst, c) => (SEVERITY[c] > SEVERITY[worst] ? c : worst), "sunny");

  return {
    temperatureC: round1(mean(temps)),
    feelsLikeC: feels.length ? round1(mean(feels)) : null,
    windSpeedKmh: round1(mean(winds)),
    windGustsKmh: gusts.length ? round1(Math.max(...gusts)) : null,
    precipitationMm: round1(nums(win(h.precipitation)).reduce((a, b) => a + b, 0)),
    precipitationProbability: probs.length ? Math.max(...probs) : null,
    condition: codes.length ? condition : "cloudy",
  };
}
