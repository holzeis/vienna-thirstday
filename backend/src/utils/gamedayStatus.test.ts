import { describe, expect, it } from "vitest";
import { effectiveGamedayStatus } from "./gamedayStatus";

describe("effectiveGamedayStatus", () => {
  it("returns OPEN for a future gameday", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60);
    expect(effectiveGamedayStatus({ status: "OPEN", date: future })).toBe("OPEN");
  });

  it("returns CLOSED for an OPEN gameday whose kickoff has passed", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60);
    expect(effectiveGamedayStatus({ status: "OPEN", date: past })).toBe("CLOSED");
  });

  it("treats the exact kickoff instant as already closed", () => {
    const now = new Date();
    expect(effectiveGamedayStatus({ status: "OPEN", date: now })).toBe("CLOSED");
  });

  it("never overrides CANCELLED, even once the date has passed", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60);
    expect(effectiveGamedayStatus({ status: "CANCELLED", date: past })).toBe("CANCELLED");
  });

  it("never overrides COMPLETED, even though its date is necessarily in the past", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60);
    expect(effectiveGamedayStatus({ status: "COMPLETED", date: past })).toBe("COMPLETED");
  });
});
