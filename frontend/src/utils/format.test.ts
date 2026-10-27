import { describe, expect, it } from "vitest";
import { formatMatchdayDate, toDatetimeLocalValue } from "./format";

// Built from local-time components on purpose: these helpers format in the
// viewer's timezone, so the tests must not depend on which one runs them.
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();

describe("formatMatchdayDate", () => {
  it("renders a compact zero-padded DD.MM. HH:mm without year or weekday", () => {
    expect(formatMatchdayDate(local(2026, 8, 3, 9, 5))).toBe("03.08. 09:05");
    expect(formatMatchdayDate(local(2026, 12, 31, 19, 0))).toBe("31.12. 19:00");
  });
});

describe("toDatetimeLocalValue", () => {
  it("formats an ISO date as the value a <input type=datetime-local> expects", () => {
    expect(toDatetimeLocalValue(local(2026, 8, 3, 9, 5))).toBe("2026-08-03T09:05");
  });
  it("defaults to now when no date is given", () => {
    expect(toDatetimeLocalValue()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
