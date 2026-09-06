import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_THRESHOLDS, tierForValue, type AchievementCategory } from "./achievementThresholds";

describe("tierForValue", () => {
  it("returns 'wood' below the bronze threshold", () => {
    expect(tierForValue("wins", 0)).toBe("wood");
    expect(tierForValue("wins", ACHIEVEMENT_THRESHOLDS.wins.bronze - 1)).toBe("wood");
  });

  it("is inclusive at each threshold boundary", () => {
    const t = ACHIEVEMENT_THRESHOLDS.points;
    expect(tierForValue("points", t.bronze)).toBe("bronze");
    expect(tierForValue("points", t.silver)).toBe("silver");
    expect(tierForValue("points", t.gold)).toBe("gold");
  });

  it("returns gold for any value at or above the gold threshold", () => {
    expect(tierForValue("goals", ACHIEVEMENT_THRESHOLDS.goals.gold + 1000)).toBe("gold");
  });

  it("has a threshold entry for every declared category", () => {
    const categories: AchievementCategory[] = ["gamesPlayed", "wins", "draws", "losses", "points", "goals"];
    for (const category of categories) {
      expect(ACHIEVEMENT_THRESHOLDS[category]).toBeDefined();
    }
  });
});
