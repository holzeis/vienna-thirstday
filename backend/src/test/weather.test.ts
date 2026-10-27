import "./testDb";
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { config } from "../config";
import { db } from "../db/client";
import { gamedays, gamedayWeather } from "../db/schema";
import { localDateAndHour } from "../utils/timezone";
import { resetDb, closeDb, createAdmin } from "./helpers";
import { buildWeatherUrl, parseOpenMeteo, planWeatherRefresh, resetWeatherRefreshState, FORECAST_TTL_MS } from "../services/weatherService";

const app = createApp();

beforeEach(() => {
  resetWeatherRefreshState();
  return resetDb();
});
afterEach(() => {
  config.weatherEnabled = false;
  vi.unstubAllGlobals();
});
afterAll(closeDb);

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** An Open-Meteo-shaped response for one local day, 19:00-21:00 filled in. */
function openMeteoBody(day: string, over: Record<string, number[]> = {}) {
  const time = Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, "0")}:00`);
  const col = (v: number) => time.map((_, h) => (h >= 19 && h <= 21 ? v : 0));
  return {
    hourly: {
      time,
      temperature_2m: col(18),
      apparent_temperature: col(16),
      precipitation: col(0),
      precipitation_probability: col(15),
      weather_code: col(0),
      wind_speed_10m: col(8),
      wind_gusts_10m: col(15),
      ...over,
    },
  };
}

async function adminToken() {
  const { password } = await createAdmin();
  const res = await request(app).post("/api/auth/login").send({ name: "Admin", password });
  return res.body.token as string;
}

describe("planWeatherRefresh", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const row = (kind: "FORECAST" | "OBSERVED", date: Date, ageMs = 0) => ({ kind, forDate: date, fetchedAt: new Date(now.getTime() - ageMs) });

  it("fetches a forecast for an upcoming match with no snapshot yet", () => {
    expect(planWeatherRefresh({ date: new Date(now.getTime() + 3 * DAY) }, undefined, now)).toBe("FORECAST");
  });
  it("does nothing beyond the 16-day forecast horizon", () => {
    expect(planWeatherRefresh({ date: new Date(now.getTime() + 20 * DAY) }, undefined, now)).toBeNull();
  });
  it("keeps a fresh forecast and refreshes one older than the TTL", () => {
    const date = new Date(now.getTime() + 2 * DAY);
    expect(planWeatherRefresh({ date }, row("FORECAST", date, FORECAST_TTL_MS - 1000), now)).toBeNull();
    expect(planWeatherRefresh({ date }, row("FORECAST", date, FORECAST_TTL_MS + 1000), now)).toBe("FORECAST");
  });
  it("refetches when the kickoff was moved since the snapshot", () => {
    const date = new Date(now.getTime() + 2 * DAY);
    expect(planWeatherRefresh({ date }, row("FORECAST", new Date(date.getTime() - DAY)), now)).toBe("FORECAST");
  });
  it("fetches observed weather once the match is over, and never again after that", () => {
    const date = new Date(now.getTime() - DAY);
    expect(planWeatherRefresh({ date }, undefined, now)).toBe("OBSERVED");
    expect(planWeatherRefresh({ date }, row("FORECAST", date, 2 * DAY), now)).toBe("OBSERVED");
    expect(planWeatherRefresh({ date }, row("OBSERVED", date, 5 * DAY), now)).toBeNull();
  });
  it("replaces an observed row whose kickoff was moved", () => {
    const date = new Date(now.getTime() - DAY);
    expect(planWeatherRefresh({ date }, row("OBSERVED", new Date(date.getTime() - 7 * DAY)), now)).toBe("OBSERVED");
  });
});

describe("buildWeatherUrl / parseOpenMeteo", () => {
  it("queries the Vienna-local day, using the archive API only for old dates", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const recent = new URL(buildWeatherUrl(new Date("2026-10-15T17:00:00Z"), now));
    expect(recent.host).toBe("api.open-meteo.com");
    expect(recent.searchParams.get("start_date")).toBe("2026-10-15");
    expect(recent.searchParams.get("timezone")).toBe("Europe/Vienna");
    expect(new URL(buildWeatherUrl(new Date("2025-01-09T18:00:00Z"), now)).host).toBe("archive-api.open-meteo.com");
  });

  it("reads the window starting at the Vienna kickoff hour (19:00 CEST = 17:00Z)", () => {
    const s = parseOpenMeteo(openMeteoBody("2026-07-02"), new Date("2026-07-02T17:00:00Z"))!;
    expect(s.temperatureC).toBe(18);
    // a kickoff at 02:00 would hit the all-zero hours instead
    expect(parseOpenMeteo(openMeteoBody("2026-07-02"), new Date("2026-07-02T00:00:00Z"))!.temperatureC).toBe(0);
  });

  it("returns null for a response with no usable data", () => {
    expect(parseOpenMeteo({}, new Date())).toBeNull();
    expect(parseOpenMeteo({ hourly: { time: ["2026-07-02T00:00"] } }, new Date("2026-07-02T17:00:00Z"))).toBeNull();
  });
});

describe("weather on the gameday routes", () => {
  it("stores and returns a forecast for an upcoming gameday, flagging wind", async () => {
    config.weatherEnabled = true;
    const date = new Date(Date.now() + 3 * DAY);
    date.setUTCHours(17, 0, 0, 0);
    const day = date.toISOString().slice(0, 10);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => openMeteoBody(day, { wind_speed_10m: Array(24).fill(30), weather_code: Array(24).fill(61), precipitation: Array(24).fill(1) }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const token = await adminToken();
    const [g] = await db.insert(gamedays).values({ date }).returning();

    const res = await request(app).get(`/api/gamedays/${g.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.gameday.weather).toMatchObject({
      kind: "FORECAST",
      condition: "rainy",
      isWindy: true,
      windSpeedKmh: 30,
      precipitationProbability: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Fresh snapshot: a second read must not hit the provider again.
    await request(app).get(`/api/gamedays/${g.id}`).set("Authorization", `Bearer ${token}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns stored observed weather on the detail route without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    config.weatherEnabled = true;
    const token = await adminToken();
    const date = new Date(Date.now() - 2 * DAY);
    const [g] = await db.insert(gamedays).values({ date, status: "COMPLETED" }).returning();
    await db.insert(gamedayWeather).values({
      gamedayId: g.id, kind: "OBSERVED", forDate: date, temperatureC: 7.5, windSpeedKmh: 4, condition: "foggy",
    });

    const res = await request(app).get(`/api/gamedays/${g.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.gameday.weather).toMatchObject({ kind: "OBSERVED", condition: "foggy", temperatureC: 7.5, isWindy: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps weather out of the list (it is shown only on the matchday page)", async () => {
    const token = await adminToken();
    await db.insert(gamedays).values({ date: new Date(Date.now() + DAY) });
    const res = await request(app).get("/api/gamedays").set("Authorization", `Bearer ${token}`);
    expect(res.body.gamedays[0]).not.toHaveProperty("weather");
  });

  it("hides a snapshot whose kickoff no longer matches, and survives a provider outage", async () => {
    config.weatherEnabled = true;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const token = await adminToken();
    const date = new Date(Date.now() + 2 * DAY);
    const [g] = await db.insert(gamedays).values({ date }).returning();
    await db.insert(gamedayWeather).values({
      gamedayId: g.id, kind: "FORECAST", forDate: new Date(date.getTime() - DAY), temperatureC: 20, windSpeedKmh: 5, condition: "sunny",
    });

    const res = await request(app).get(`/api/gamedays/${g.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.gameday.weather).toBeNull();
  });

  it("reports no weather when the feature is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const token = await adminToken();
    const [g] = await db.insert(gamedays).values({ date: new Date(Date.now() + DAY) }).returning();
    const res = await request(app).get(`/api/gamedays/${g.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.gameday.weather).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includes the forecast on the public share-link lookup, without any login", async () => {
    config.weatherEnabled = true;
    const date = new Date(Date.now() + 2 * DAY);
    // Kick off at 19:00 Vienna time (the start of the filled-in hours in openMeteoBody) whichever side of
    // the DST change "now + 2 days" falls on: that is 17:00 UTC in summer time, 18:00 UTC in winter time.
    date.setUTCHours(17, 0, 0, 0);
    if (localDateAndHour(date, "Europe/Vienna").hour !== 19) date.setUTCHours(18);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => openMeteoBody(date.toISOString().slice(0, 10)) }));
    const [g] = await db.insert(gamedays).values({ date, shareToken: "weather-share-token" }).returning();

    const res = await request(app).get("/api/gameday-share/weather-share-token");
    expect(res.status).toBe(200);
    expect(res.body.gameday.id).toBe(g.id);
    expect(res.body.gameday.weather).toMatchObject({ kind: "FORECAST", condition: "sunny", temperatureC: 18, isWindy: false });
  });
});
