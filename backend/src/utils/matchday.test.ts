import { describe, expect, it } from "vitest";
import { computeMatchdayNumbers } from "./matchday";

describe("computeMatchdayNumbers", () => {
  it("numbers gamedays 1, 2, 3... in chronological order", () => {
    const rows = [
      { id: 10, date: new Date("2024-01-04T19:00:00Z") },
      { id: 11, date: new Date("2024-01-11T19:00:00Z") },
      { id: 12, date: new Date("2024-01-18T19:00:00Z") },
    ];
    const result = computeMatchdayNumbers(rows);
    expect(result.get(10)).toBe(1);
    expect(result.get(11)).toBe(2);
    expect(result.get(12)).toBe(3);
  });

  it("restarts numbering at 1 for each new calendar year", () => {
    const rows = [
      { id: 1, date: new Date("2024-12-26T19:00:00Z") },
      { id: 2, date: new Date("2025-01-02T19:00:00Z") },
      { id: 3, date: new Date("2025-01-09T19:00:00Z") },
    ];
    const result = computeMatchdayNumbers(rows);
    expect(result.get(1)).toBe(1);
    expect(result.get(2)).toBe(1);
    expect(result.get(3)).toBe(2);
  });

  it("counts every gameday regardless of status - the sequence is purely chronological", () => {
    // computeMatchdayNumbers itself has no notion of status - the caller
    // decides which rows to include. This just confirms it doesn't skip
    // anything or reorder based on anything but the given order.
    const rows = [
      { id: 1, date: new Date("2026-01-01T19:00:00Z") },
      { id: 2, date: new Date("2026-01-08T19:00:00Z") },
    ];
    const result = computeMatchdayNumbers(rows);
    expect(result.size).toBe(2);
  });

  it("returns an empty map for no gamedays", () => {
    expect(computeMatchdayNumbers([]).size).toBe(0);
  });
});
