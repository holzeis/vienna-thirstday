import { describe, expect, it } from "vitest";
import { computeTeamResult } from "./scoring";

describe("computeTeamResult", () => {
  it("awards 4 points and a positive goal-diff for a win", () => {
    expect(computeTeamResult(5, 2)).toEqual({ points: 4, goalDiff: 3 });
  });

  it("awards 1 point and a negative goal-diff for a loss", () => {
    expect(computeTeamResult(2, 5)).toEqual({ points: 1, goalDiff: -3 });
  });

  it("awards 2 points and a zero goal-diff for a draw", () => {
    expect(computeTeamResult(3, 3)).toEqual({ points: 2, goalDiff: 0 });
  });

  it("treats a 0-0 scoreline as a draw, not a loss", () => {
    expect(computeTeamResult(0, 0)).toEqual({ points: 2, goalDiff: 0 });
  });
});
