import { describe, expect, it } from "vitest";
import {
  computeCareerStats,
  computeCurrentForm,
  computeMomentum,
  computeNemesis,
  computePersonalAwards,
  computePlayerSeasonAwards,
  computeSeasonPodiums,
  computeStreaks,
  computeTeammateTally,
  type StatRow,
} from "./playerStatsService";

function row(overrides: Partial<StatRow> & { playerId: number }): StatRow {
  return {
    playerName: `Player${overrides.playerId}`,
    isGuest: false,
    gamedayId: 1,
    date: new Date("2024-01-01T18:00:00Z"),
    team: "A",
    points: 4,
    goalDiff: 2,
    teamScore: 5,
    ...overrides,
  };
}

describe("computeCareerStats", () => {
  it("returns all-zero stats for no games", () => {
    expect(computeCareerStats([])).toEqual({
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goalDiff: 0,
      goals: 0,
    });
  });

  it("tallies wins/draws/losses by the stored points value, not the raw score", () => {
    const rows = [
      row({ playerId: 1, points: 4, goalDiff: 3, teamScore: 5 }), // win
      row({ playerId: 1, points: 2, goalDiff: 0, teamScore: 2 }), // draw
      row({ playerId: 1, points: 1, goalDiff: -2, teamScore: 1 }), // loss
    ];
    expect(computeCareerStats(rows)).toEqual({
      gamesPlayed: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      points: 7,
      goalDiff: 1,
      goals: 8,
    });
  });
});

describe("computeStreaks", () => {
  it("finds the longest win and loss streaks, resetting on a draw", () => {
    // W W L L L D W
    const points = [4, 4, 1, 1, 1, 2, 4];
    const rows = points.map((p) => row({ playerId: 1, points: p }));
    expect(computeStreaks(rows)).toEqual({ longestWinStreak: 2, longestLossStreak: 3 });
  });

  it("returns zeros for no games", () => {
    expect(computeStreaks([])).toEqual({ longestWinStreak: 0, longestLossStreak: 0 });
  });

  it("a draw breaks both a win streak and a loss streak", () => {
    const points = [4, 4, 4, 2, 1, 1];
    const rows = points.map((p) => row({ playerId: 1, points: p }));
    expect(computeStreaks(rows)).toEqual({ longestWinStreak: 3, longestLossStreak: 2 });
  });
});

describe("computeTeammateTally", () => {
  it("finds the favorite (most shared wins), unfavorite (most shared losses), and most-played-with teammate", () => {
    const allRows: StatRow[] = [
      // Gamedays 1-3: me + Alice win together 3 times
      ...[1, 2, 3].flatMap((gamedayId) => [
        row({ playerId: 1, gamedayId, team: "A", points: 4 }),
        row({ playerId: 2, playerName: "Alice", gamedayId, team: "A", points: 4 }),
      ]),
      // Gamedays 4-6: me + Bob lose together 3 times
      ...[4, 5, 6].flatMap((gamedayId) => [
        row({ playerId: 1, gamedayId, team: "B", points: 1 }),
        row({ playerId: 3, playerName: "Bob", gamedayId, team: "B", points: 1 }),
      ]),
    ];

    const { favorite, unfavorite, mostPlayedWith } = computeTeammateTally(allRows, 1);
    expect(favorite).toMatchObject({ playerId: 2, name: "Alice", sharedWins: 3, sharedGames: 3 });
    expect(unfavorite).toMatchObject({ playerId: 3, name: "Bob", sharedLosses: 3, sharedGames: 3 });
    expect(mostPlayedWith).toMatchObject({ sharedGames: 3 });
  });

  it("doesn't name a favorite/unfavorite until shared wins/losses reach the threshold, unlike most-played-with", () => {
    const allRows: StatRow[] = [1, 2].flatMap((gamedayId) => [
      row({ playerId: 1, gamedayId, team: "A", points: 4 }),
      row({ playerId: 2, playerName: "Alice", gamedayId, team: "A", points: 4 }),
    ]);
    const { favorite, mostPlayedWith } = computeTeammateTally(allRows, 1);
    expect(favorite).toBeNull();
    expect(mostPlayedWith).toMatchObject({ playerId: 2, sharedGames: 2 });
  });

  it("only tallies players who shared the same team, not opponents", () => {
    const allRows: StatRow[] = [
      row({ playerId: 1, gamedayId: 1, team: "A", points: 4 }),
      row({ playerId: 2, playerName: "Teammate", gamedayId: 1, team: "A", points: 4 }),
      row({ playerId: 3, playerName: "Opponent", gamedayId: 1, team: "B", points: 1 }),
    ];
    const { mostPlayedWith } = computeTeammateTally(allRows, 1);
    expect(mostPlayedWith?.playerId).toBe(2);
  });

  it("returns nulls when the player has never shared a team with anyone", () => {
    const result = computeTeammateTally([row({ playerId: 1 })], 1);
    expect(result).toEqual({ favorite: null, unfavorite: null, mostPlayedWith: null });
  });
});

describe("computeNemesis", () => {
  it("names an opponent as nemesis after losing to them at least 3 times", () => {
    const rows: StatRow[] = [1, 2, 3].flatMap((gamedayId) => [
      row({ playerId: 1, gamedayId, team: "A", points: 1 }),
      row({ playerId: 2, playerName: "Nemesis", gamedayId, team: "B", points: 4 }),
    ]);
    const nemesis = computeNemesis(rows, 1);
    expect(nemesis).toMatchObject({ playerId: 2, name: "Nemesis", gamesAgainst: 3, lossesAgainst: 3 });
  });

  it("returns null when losses against an opponent fall short of the threshold", () => {
    const rows: StatRow[] = [1, 2].flatMap((gamedayId) => [
      row({ playerId: 1, gamedayId, team: "A", points: 1 }),
      row({ playerId: 2, gamedayId, team: "B", points: 4 }),
    ]);
    expect(computeNemesis(rows, 1)).toBeNull();
  });

  it("only counts games actually lost against that opponent, not wins or draws", () => {
    const points = [1, 4, 1, 1]; // 1 win mixed in among 3 losses, same opponent every game
    const rows: StatRow[] = points.flatMap((p, i) => [
      row({ playerId: 1, gamedayId: i, team: "A", points: p }),
      row({ playerId: 2, gamedayId: i, team: "B", points: p === 1 ? 4 : 1 }),
    ]);
    const nemesis = computeNemesis(rows, 1);
    expect(nemesis).toMatchObject({ playerId: 2, gamesAgainst: 4, lossesAgainst: 3 });
  });

  it("ignores teammates - only the opposing team counts as an opponent", () => {
    const rows: StatRow[] = [1, 2, 3].flatMap((gamedayId) => [
      row({ playerId: 1, gamedayId, team: "A", points: 1 }),
      // Same team every game and would tie on losses/games-faced if wrongly
      // tallied as an opponent - and would win the name tie-break too, so
      // this only passes if the team filter correctly excludes them.
      row({ playerId: 2, playerName: "AAA Teammate", gamedayId, team: "A", points: 1 }),
      row({ playerId: 3, playerName: "ZZZ Opponent", gamedayId, team: "B", points: 4 }),
    ]);
    expect(computeNemesis(rows, 1)?.playerId).toBe(3);
  });

  it("breaks a tie between two qualifying nemeses by games faced, then name", () => {
    const rows: StatRow[] = [1, 2, 3]
      .flatMap((gamedayId) => [
        row({ playerId: 1, gamedayId, team: "A", points: 1 }),
        row({ playerId: 2, playerName: "Bob", gamedayId, team: "B", points: 4 }),
      ])
      .concat(
        [4, 5, 6].flatMap((gamedayId) => [
          row({ playerId: 1, gamedayId, team: "A", points: 1 }),
          row({ playerId: 3, playerName: "Alice", gamedayId, team: "B", points: 4 }),
        ])
      );
    expect(computeNemesis(rows, 1)?.name).toBe("Alice");
  });
});

describe("computeCurrentForm", () => {
  it("awards veteran when the player appears in all of the league's last 5 gamedays", () => {
    const allRows: StatRow[] = [1, 2, 3, 4, 5].map((gamedayId) =>
      row({ playerId: 1, gamedayId, date: new Date(2024, 0, gamedayId), points: 2 })
    );
    expect(computeCurrentForm(allRows, 1).veteran).toBe(true);
  });

  it("does not award veteran if the player missed one of the league's last 5 gamedays", () => {
    const allRows: StatRow[] = [1, 2, 3, 4, 5].map((gamedayId) => row({ playerId: 99, gamedayId, date: new Date(2024, 0, gamedayId) }));
    // Player 1 only played 4 of the 5 most recent league gamedays.
    const mine = [1, 2, 3, 4].map((gamedayId) => row({ playerId: 1, gamedayId, date: new Date(2024, 0, gamedayId) }));
    expect(computeCurrentForm([...allRows, ...mine], 1).veteran).toBe(false);
  });

  it("awards undefeated when the player's last 5 games were all wins or draws", () => {
    const points = [4, 2, 4, 4, 2];
    const rows = points.map((p, i) => row({ playerId: 1, gamedayId: i, date: new Date(2024, 0, i + 1), points: p }));
    expect(computeCurrentForm(rows, 1).undefeated).toBe(true);
    expect(computeCurrentForm(rows, 1).unlucky).toBe(false);
  });

  it("awards unlucky when the player's last 5 games were all losses", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => row({ playerId: 1, gamedayId: i, date: new Date(2024, 0, i), points: 1 }));
    expect(computeCurrentForm(rows, 1).unlucky).toBe(true);
    expect(computeCurrentForm(rows, 1).undefeated).toBe(false);
  });

  it("a single loss within the last 5 breaks undefeated", () => {
    const points = [4, 4, 4, 4, 1];
    const rows = points.map((p, i) => row({ playerId: 1, gamedayId: i, date: new Date(2024, 0, i + 1), points: p }));
    expect(computeCurrentForm(rows, 1).undefeated).toBe(false);
  });

  it("requires 5 of the player's own games before judging undefeated/unlucky", () => {
    const rows = [1, 2, 3].map((i) => row({ playerId: 1, gamedayId: i, date: new Date(2024, 0, i), points: 4 }));
    const form = computeCurrentForm(rows, 1);
    expect(form.undefeated).toBe(false);
    expect(form.unlucky).toBe(false);
  });

  it("awards ghost when the player appears in none of the league's last 5 gamedays", () => {
    const allRows: StatRow[] = [1, 2, 3, 4, 5].map((gamedayId) => row({ playerId: 99, gamedayId, date: new Date(2024, 0, gamedayId) }));
    // Player 1 never shows up in any of those gamedays.
    expect(computeCurrentForm(allRows, 1).ghost).toBe(true);
    expect(computeCurrentForm(allRows, 1).veteran).toBe(false);
  });

  it("does not award ghost if the player appeared in even one of the last 5 gamedays", () => {
    const allRows: StatRow[] = [1, 2, 3, 4, 5].map((gamedayId) => row({ playerId: 99, gamedayId, date: new Date(2024, 0, gamedayId) }));
    const mine = [row({ playerId: 1, gamedayId: 3, date: new Date(2024, 0, 3) })];
    expect(computeCurrentForm([...allRows, ...mine], 1).ghost).toBe(false);
  });

  it("does not award ghost or veteran when the league has fewer than 5 gamedays yet", () => {
    const allRows: StatRow[] = [1, 2].map((gamedayId) => row({ playerId: 99, gamedayId, date: new Date(2024, 0, gamedayId) }));
    const form = computeCurrentForm(allRows, 1);
    expect(form.ghost).toBe(false);
    expect(form.veteran).toBe(false);
  });

  it("never awards ghost and undefeated together, even for a player whose own last 5 played games are far in the past", () => {
    // Player 1 won their last 5 *personal* games, but that was a while ago -
    // the league's actual last 5 gamedays (6-10) were played without them.
    const oldWins = [1, 2, 3, 4, 5].map((gamedayId) => row({ playerId: 1, gamedayId, date: new Date(2024, 0, gamedayId), points: 4 }));
    const recentWithoutThem = [6, 7, 8, 9, 10].map((gamedayId) => row({ playerId: 99, gamedayId, date: new Date(2024, 1, gamedayId) }));
    const form = computeCurrentForm([...oldWins, ...recentWithoutThem], 1);
    expect(form.ghost).toBe(true);
    expect(form.undefeated).toBe(false);
    expect(form.veteran).toBe(false);
    expect(form.unlucky).toBe(false);
  });
});

describe("computeMomentum", () => {
  it("returns 'new' when there's no prior rank to compare (a season debut)", () => {
    expect(computeMomentum(undefined, 3)).toBe("new");
  });

  it("returns a positive delta when rank improved (a lower rank number)", () => {
    expect(computeMomentum(5, 2)).toBe(3);
  });

  it("returns a negative delta when rank dropped", () => {
    expect(computeMomentum(2, 5)).toBe(-3);
  });

  it("returns 0 when rank is unchanged", () => {
    expect(computeMomentum(4, 4)).toBe(0);
  });
});

describe("computeSeasonPodiums", () => {
  it("awards gold/silver/bronze to the top 3 distinct players by the category's metric", () => {
    const rows: StatRow[] = [
      row({ playerId: 1, playerName: "Lukas", points: 4, goalDiff: 3, teamScore: 5 }),
      row({ playerId: 2, playerName: "Tobias", points: 2, goalDiff: 0, teamScore: 2 }),
      row({ playerId: 3, playerName: "David", points: 1, goalDiff: -3, teamScore: 1 }),
    ];
    const podiums = computeSeasonPodiums(rows);
    expect(podiums.ranking.gold).toMatchObject({ playerId: 1, value: 4 });
    expect(podiums.ranking.silver).toMatchObject({ playerId: 2, value: 2 });
    expect(podiums.ranking.bronze).toMatchObject({ playerId: 3, value: 1 });
  });

  it("carries each entry's isGuest flag through to the podium, guests included", () => {
    const rows: StatRow[] = [
      row({ playerId: 1, playerName: "Lukas", isGuest: false, points: 4, goalDiff: 3, teamScore: 5 }),
      row({ playerId: 2, playerName: "Robert", isGuest: true, points: 2, goalDiff: 0, teamScore: 2 }),
    ];
    const { gold, silver } = computeSeasonPodiums(rows).ranking;
    expect(gold).toMatchObject({ playerId: 1, isGuest: false });
    expect(silver).toMatchObject({ playerId: 2, isGuest: true });
  });

  it("resolves a fully-tied ranking with goal-diff, then wins, then fewer games, then name", () => {
    // Alice and Bob have identical points/goalDiff/wins/games - only name differs.
    const rows: StatRow[] = [
      row({ playerId: 1, playerName: "Bob", points: 4, goalDiff: 3, teamScore: 5 }),
      row({ playerId: 2, playerName: "Alice", points: 4, goalDiff: 3, teamScore: 5 }),
    ];
    const { gold, silver } = computeSeasonPodiums(rows).ranking;
    expect(gold?.name).toBe("Alice");
    expect(silver?.name).toBe("Bob");
  });

  it("breaks a tie in a non-ranking category using points, then goal-diff, then name", () => {
    // Both played 2 games (tied on the primary "most games" metric); Alice has more points.
    const rows: StatRow[] = [
      row({ playerId: 1, playerName: "Bob", gamedayId: 1, points: 2, goalDiff: 0 }),
      row({ playerId: 1, playerName: "Bob", gamedayId: 2, points: 2, goalDiff: 0 }),
      row({ playerId: 2, playerName: "Alice", gamedayId: 1, points: 4, goalDiff: 3 }),
      row({ playerId: 2, playerName: "Alice", gamedayId: 2, points: 2, goalDiff: 0 }),
    ];
    const { gold, silver } = computeSeasonPodiums(rows).mostGames;
    expect(gold).toMatchObject({ playerId: 2, value: 2 });
    expect(silver).toMatchObject({ playerId: 1, value: 2 });
  });

  it("never awards a medal for a non-positive value", () => {
    const rows: StatRow[] = [row({ playerId: 1, points: 2, goalDiff: 0, teamScore: 0 })];
    // longestLossStreak is 0 for a player who only ever drew - no bronze for "0".
    expect(computeSeasonPodiums(rows).longestLossStreak).toEqual({ gold: null, silver: null, bronze: null });
  });

  it("leaves unfilled medals null when there are fewer than 3 eligible players", () => {
    const rows: StatRow[] = [row({ playerId: 1, points: 4, goalDiff: 2, teamScore: 4 })];
    const { gold, silver, bronze } = computeSeasonPodiums(rows).ranking;
    expect(gold).not.toBeNull();
    expect(silver).toBeNull();
    expect(bronze).toBeNull();
  });
});

describe("computePersonalAwards", () => {
  const zeroCareer = { gamesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, goalDiff: 0, goals: 0 };

  it("always includes the lifetime stat categories, using 'wood' below bronze", () => {
    const awards = computePersonalAwards(zeroCareer, false);
    const categories = awards.map((a) => a.category);
    expect(categories).toEqual(expect.arrayContaining(["gamesPlayed", "wins", "draws", "losses", "points", "goals"]));
    expect(awards.find((a) => a.category === "gamesPlayed")).toMatchObject({ tier: "wood", value: 0 });
  });

  it("omits the admin badge when the player is not an admin", () => {
    const awards = computePersonalAwards(zeroCareer, false);
    expect(awards.find((a) => a.category === "isAdmin")).toBeUndefined();
  });

  it("includes the admin badge (gold) when the player is an admin", () => {
    const awards = computePersonalAwards(zeroCareer, true);
    expect(awards.find((a) => a.category === "isAdmin")).toMatchObject({ tier: "gold", value: 1 });
  });

  it("promotes a stat to bronze/silver/gold once it crosses each threshold", () => {
    const career = { ...zeroCareer, wins: 40 }; // silver threshold for wins
    const award = computePersonalAwards(career, false).find((a) => a.category === "wins");
    expect(award).toMatchObject({ tier: "silver", value: 40 });
  });
});

describe("computePlayerSeasonAwards", () => {
  const lastYear = new Date().getUTCFullYear() - 1;
  const currentYear = new Date().getUTCFullYear();

  it("awards a season medal for a completed past season", () => {
    const allRows: StatRow[] = [
      row({ playerId: 1, playerName: "Lukas", date: new Date(Date.UTC(lastYear, 5, 1)), points: 4, goalDiff: 3, teamScore: 5 }),
    ];
    const awards = computePlayerSeasonAwards(allRows, 1);
    expect(awards.some((a) => a.kind === "season" && a.season === lastYear && a.category === "ranking")).toBe(true);
  });

  it("never awards a season medal for the current, still-in-progress year", () => {
    const allRows: StatRow[] = [
      row({ playerId: 1, date: new Date(Date.UTC(currentYear, 0, 15)), points: 4, goalDiff: 3, teamScore: 5 }),
    ];
    expect(computePlayerSeasonAwards(allRows, 1)).toEqual([]);
  });

  it("includes guest players in season awards, same as registered players", () => {
    const allRows: StatRow[] = [
      row({ playerId: 1, isGuest: true, date: new Date(Date.UTC(lastYear, 5, 1)), points: 4, goalDiff: 3, teamScore: 5 }),
    ];
    const awards = computePlayerSeasonAwards(allRows, 1);
    expect(awards.some((a) => a.kind === "season" && a.season === lastYear && a.category === "ranking")).toBe(true);
  });

  it("sorts multiple seasons' awards most-recent-first", () => {
    const twoYearsAgo = lastYear - 1;
    const allRows: StatRow[] = [
      row({ playerId: 1, date: new Date(Date.UTC(twoYearsAgo, 5, 1)), points: 4, goalDiff: 3, teamScore: 5 }),
      row({ playerId: 1, gamedayId: 2, date: new Date(Date.UTC(lastYear, 5, 1)), points: 4, goalDiff: 3, teamScore: 5 }),
    ];
    const seasons = computePlayerSeasonAwards(allRows, 1).map((a) => a.season);
    expect(seasons[0]).toBe(lastYear);
    expect(seasons[seasons.length - 1]).toBe(twoYearsAgo);
  });
});
