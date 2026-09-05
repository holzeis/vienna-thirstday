/**
 * Tier thresholds for lifetime player achievements. Calibrated for a hobby
 * five-a-side league playing roughly weekly (~45 games/season): bronze marks
 * a committed season, silver a couple of strong seasons, gold multi-year
 * veteran status. Kept separate from the computation logic so these can be
 * retuned without touching playerStatsService.
 */
export type AchievementCategory = "gamesPlayed" | "wins" | "draws" | "losses" | "points" | "goals" | "isAdmin";
/** "wood" is the below-bronze rung - shown (with the real value) for the lifetime stat
 * categories that always render, never shown for isAdmin (that one is omitted instead). */
export type AchievementTier = "wood" | "bronze" | "silver" | "gold";

export const ACHIEVEMENT_THRESHOLDS: Record<AchievementCategory, { bronze: number; silver: number; gold: number }> = {
  gamesPlayed: { bronze: 15, silver: 60, gold: 150 },
  wins: { bronze: 10, silver: 40, gold: 100 },
  draws: { bronze: 5, silver: 15, gold: 35 },
  losses: { bronze: 10, silver: 40, gold: 100 },
  points: { bronze: 60, silver: 220, gold: 500 },
  goals: { bronze: 75, silver: 300, gold: 750 },
  // Binary: any admin gets gold outright, no bronze/silver rungs to climb.
  isAdmin: { bronze: 1, silver: 1, gold: 1 },
};

export function tierForValue(category: AchievementCategory, value: number): AchievementTier {
  const t = ACHIEVEMENT_THRESHOLDS[category];
  if (value >= t.gold) return "gold";
  if (value >= t.silver) return "silver";
  if (value >= t.bronze) return "bronze";
  return "wood";
}
