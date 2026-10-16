import { describe, it, expect } from "vitest";
import { conditionFromWmoCode, isWindy, summarizeWindow, type HourlySlice } from "./weather";

describe("conditionFromWmoCode", () => {
  it.each([
    [0, "sunny"],
    [1, "sunny"],
    [3, "cloudy"],
    [45, "foggy"],
    [53, "drizzle"],
    [63, "rainy"],
    [81, "rainy"],
    [73, "snowy"],
    [86, "snowy"],
    [95, "stormy"],
    [99, "stormy"],
    [10, "cloudy"],
  ])("maps WMO code %i to %s", (code, expected) => {
    expect(conditionFromWmoCode(code)).toBe(expected);
  });
});

describe("isWindy", () => {
  it("is windy at the mean-wind threshold but not below it", () => {
    expect(isWindy(20)).toBe(true);
    expect(isWindy(19.9)).toBe(false);
  });
  it("is windy on strong gusts even when the mean wind is calm", () => {
    expect(isWindy(10, 40)).toBe(true);
    expect(isWindy(10, 30)).toBe(false);
    expect(isWindy(10, null)).toBe(false);
  });
});

describe("summarizeWindow", () => {
  const slice = (over: Partial<HourlySlice> = {}): HourlySlice => ({
    temperature: [5, 10, 14, 12, 3],
    apparentTemperature: [3, 8, 12, 10, 1],
    precipitation: [9, 0, 0.5, 0.25, 9],
    precipitationProbability: [90, 10, 20, 60, 90],
    weatherCode: [65, 0, 61, 3, 95],
    windSpeed: [50, 10, 20, 12, 50],
    windGusts: [80, 20, 35, 25, 80],
    ...over,
  });

  it("only looks at the requested window, averaging temp/wind and taking worst-case rain/gusts/condition", () => {
    const s = summarizeWindow(slice(), 1, 3)!; // indices 1..3
    expect(s.temperatureC).toBe(12);
    expect(s.feelsLikeC).toBe(10);
    expect(s.windSpeedKmh).toBe(14);
    expect(s.windGustsKmh).toBe(35);
    expect(s.precipitationMm).toBe(0.8);
    expect(s.precipitationProbability).toBe(60);
    expect(s.condition).toBe("rainy");
  });

  it("returns null when the provider has no data for the window", () => {
    const empty = slice({ temperature: [null, null, null, null, null], windSpeed: [null, null, null, null, null] });
    expect(summarizeWindow(empty, 1, 3)).toBeNull();
    expect(summarizeWindow(slice(), 10, 3)).toBeNull();
  });

  it("keeps the probability null when absent (archive data has none)", () => {
    const s = summarizeWindow(slice({ precipitationProbability: [null, null, null, null, null] }), 1, 3)!;
    expect(s.precipitationProbability).toBeNull();
  });
});
