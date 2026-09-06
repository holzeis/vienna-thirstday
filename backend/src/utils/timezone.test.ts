import { afterEach, describe, expect, it, vi } from "vitest";
import { isPastLocalDay, zonedTimeToUtc } from "./timezone";

describe("zonedTimeToUtc", () => {
  it("converts 19:00 Vienna time to 17:00 UTC in summer (CEST, UTC+2)", () => {
    const result = zonedTimeToUtc("2026-08-13", 19, 0, "Europe/Vienna");
    expect(result.toISOString()).toBe("2026-08-13T17:00:00.000Z");
  });

  it("converts 19:00 Vienna time to 18:00 UTC in winter (CET, UTC+1)", () => {
    const result = zonedTimeToUtc("2024-01-04", 19, 0, "Europe/Vienna");
    expect(result.toISOString()).toBe("2024-01-04T18:00:00.000Z");
  });

  it("handles a date just after the spring-forward DST transition (CEST)", () => {
    // Europe/Vienna moves to CEST on the last Sunday of March.
    const result = zonedTimeToUtc("2026-03-30", 19, 0, "Europe/Vienna");
    expect(result.toISOString()).toBe("2026-03-30T17:00:00.000Z");
  });

  it("handles a date just before the autumn fall-back DST transition (still CEST)", () => {
    const result = zonedTimeToUtc("2026-10-24", 19, 0, "Europe/Vienna");
    expect(result.toISOString()).toBe("2026-10-24T17:00:00.000Z");
  });

  it("handles a date just after the autumn fall-back DST transition (back to CET)", () => {
    const result = zonedTimeToUtc("2026-11-01", 19, 0, "Europe/Vienna");
    expect(result.toISOString()).toBe("2026-11-01T18:00:00.000Z");
  });
});

describe("isPastLocalDay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is false while it's still earlier the same Vienna calendar day as the gameday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T20:30:00.000Z")); // 22:30 Vienna (CEST)
    const gamedayDate = zonedTimeToUtc("2026-08-13", 19, 0, "Europe/Vienna");
    expect(isPastLocalDay(gamedayDate, "Europe/Vienna")).toBe(false);
  });

  it("is false right up to the last moment of the gameday's local day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T21:59:59.000Z")); // 23:59:59 Vienna (CEST)
    const gamedayDate = zonedTimeToUtc("2026-08-13", 19, 0, "Europe/Vienna");
    expect(isPastLocalDay(gamedayDate, "Europe/Vienna")).toBe(false);
  });

  it("is true the moment it becomes the next Vienna calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T22:00:00.000Z")); // 00:00:00 Vienna the next day (CEST)
    const gamedayDate = zonedTimeToUtc("2026-08-13", 19, 0, "Europe/Vienna");
    expect(isPastLocalDay(gamedayDate, "Europe/Vienna")).toBe(true);
  });

  it("is true for a gameday well in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    const gamedayDate = zonedTimeToUtc("2026-08-13", 19, 0, "Europe/Vienna");
    expect(isPastLocalDay(gamedayDate, "Europe/Vienna")).toBe(true);
  });
});
