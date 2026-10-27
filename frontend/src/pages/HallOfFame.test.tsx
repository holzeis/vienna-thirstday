import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "../api/endpoints";
import type { HallOfFameResponse, PodiumAward, SeasonAwardCategory } from "../api/types";
import { HallOfFame } from "./HallOfFame";

vi.mock("../api/endpoints");

const empty: PodiumAward = { gold: null, silver: null, bronze: null };
const entry = (playerId: number, name: string, value: number) => ({ playerId, name, isGuest: false, value });

function response(year: number, over: Partial<Record<SeasonAwardCategory, PodiumAward>> = {}): HallOfFameResponse {
  return {
    year,
    seasonComplete: true,
    podiums: { ranking: empty, mostGames: empty, mostGoals: empty, longestWinStreak: empty, longestLossStreak: empty, ...over },
  };
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <HallOfFame />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z"), toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("HallOfFame", () => {
  it("only offers completed seasons - not the current one - and opens on the most recent", async () => {
    vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2026, 2025, 2024] });
    vi.mocked(endpoints.getHallOfFame).mockResolvedValue(response(2025));
    renderPage();

    await waitFor(() => expect(endpoints.getHallOfFame).toHaveBeenCalledWith(2025));
    expect(screen.queryByRole("button", { name: "2026" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2025" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "2024" })).toBeInTheDocument();
  });

  it("explains the empty state when no season has completed yet", async () => {
    vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2026] });
    vi.mocked(endpoints.getHallOfFame).mockResolvedValue(response(2025));
    renderPage();
    expect(await screen.findByText(/No completed seasons yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2026" })).not.toBeInTheDocument();
  });

  it("shows each category's gold, silver and bronze winners, linked to their profiles", async () => {
    vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2025] });
    vi.mocked(endpoints.getHallOfFame).mockResolvedValue(
      response(2025, { ranking: { gold: entry(1, "Robert", 40), silver: entry(2, "Benji", 35), bronze: null } })
    );
    renderPage();

    const row = (await screen.findAllByText(/Season Ranking/))[0].closest("tr")!;
    expect(within(row).getByRole("link", { name: /Robert/ })).toHaveAttribute("href", "/players/1");
    expect(within(row).getByRole("link", { name: /Benji/ })).toHaveAttribute("href", "/players/2");
    // A vacant medal renders a dash rather than disappearing.
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("lists every award category", async () => {
    vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2025] });
    vi.mocked(endpoints.getHallOfFame).mockResolvedValue(response(2025));
    renderPage();
    for (const label of ["Season Ranking", "Most Games", "Most Goals", "Win Streak", "Loss Streak"]) {
      expect((await screen.findAllByText(new RegExp(label))).length).toBeGreaterThan(0);
    }
  });

  it("loads another season when its tab is clicked", async () => {
    vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2025, 2024] });
    vi.mocked(endpoints.getHallOfFame).mockImplementation(async (year) =>
      response(year!, { ranking: { gold: entry(1, year === 2025 ? "Champion 2025" : "Champion 2024", 1), silver: null, bronze: null } })
    );
    renderPage();
    expect((await screen.findAllByText(/Champion 2025/))[0]).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2024" }));
    expect((await screen.findAllByText(/Champion 2024/))[0]).toBeInTheDocument();
    expect(screen.queryByText(/Champion 2025/)).not.toBeInTheDocument();
  });
});
