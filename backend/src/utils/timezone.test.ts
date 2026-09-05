import { describe, expect, it } from "vitest";
import { zonedTimeToUtc } from "./timezone";

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
