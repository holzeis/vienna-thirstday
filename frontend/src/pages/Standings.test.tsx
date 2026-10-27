import { act, render, screen, waitFor, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "../api/endpoints";
import { noForm, standingRow } from "../test/fixtures";
import { Standings } from "./Standings";

vi.mock("../api/endpoints");
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ player: { id: 2 } }) }));

const renderPage = () =>
  render(
    <MemoryRouter>
      <Standings />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z"), shouldAdvanceTime: true });
  vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2026, 2025] });
  vi.mocked(endpoints.getStandings).mockResolvedValue({ year: 2026, standings: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Standings", () => {
  it("opens on the current year and lists the ranked players", async () => {
    vi.mocked(endpoints.getStandings).mockResolvedValue({
      year: 2026,
      standings: [
        standingRow({ rank: 1, playerId: 1, name: "Robert", points: 24, goalDiff: 7, gamesPlayed: 6 }),
        standingRow({ rank: 2, playerId: 2, name: "Me", points: 20, goalDiff: -3, gamesPlayed: 5 }),
      ],
    });
    renderPage();

    expect(await screen.findByText("Robert")).toBeInTheDocument();
    expect(endpoints.getStandings).toHaveBeenCalledWith(2026);
    expect(screen.getByRole("button", { name: "2026" })).toHaveClass("active");

    const robert = screen.getByText("Robert").closest("tr")!;
    expect(within(robert).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1", "Robert", "6", "24", "+7"]);
    const me = screen.getByText("Me").closest("tr")!;
    expect(within(me).getByText("-3")).toBeInTheDocument();
  });

  it("highlights the logged-in player's own row", async () => {
    vi.mocked(endpoints.getStandings).mockResolvedValue({
      year: 2026,
      standings: [standingRow({ playerId: 1, name: "Robert" }), standingRow({ rank: 2, playerId: 2, name: "Me" })],
    });
    renderPage();
    expect((await screen.findByText("Me")).closest("tr")).toHaveClass("me");
    expect(screen.getByText("Robert").closest("tr")).not.toHaveClass("me");
  });

  it("links each player to their profile", async () => {
    vi.mocked(endpoints.getStandings).mockResolvedValue({ year: 2026, standings: [standingRow({ playerId: 42, name: "Robert" })] });
    renderPage();
    expect(await screen.findByRole("link", { name: "Robert" })).toHaveAttribute("href", "/players/42");
  });

  it("shows rank movement and the player badges", async () => {
    vi.mocked(endpoints.getStandings).mockResolvedValue({
      year: 2026,
      standings: [
        standingRow({ rank: 1, playerId: 1, name: "Up", momentum: 2, previousSeasonTitle: "champion", isNewcomer: true }),
        standingRow({ rank: 2, playerId: 3, name: "Down", momentum: -1, currentForm: { ...noForm, ghost: true } }),
        standingRow({ rank: 3, playerId: 4, name: "Same", momentum: 0 }),
      ],
    });
    renderPage();
    const up = (await screen.findByText("Up")).closest("tr")!;
    expect(within(up).getByTitle("Up 2 since the last matchday")).toHaveTextContent("▲2");
    expect(within(up).getByTitle("Champion, 2025 season")).toBeInTheDocument();
    expect(within(up).getByTitle(/Newcomer/)).toBeInTheDocument();
    const down = screen.getByText("Down").closest("tr")!;
    expect(within(down).getByTitle("Down 1 since the last matchday")).toHaveTextContent("▼1");
    expect(within(down).getByTitle(/Ghost/)).toBeInTheDocument();
    expect(within(screen.getByText("Same").closest("tr")!).queryByTitle(/since the last matchday/)).not.toBeInTheDocument();
  });

  it("says so when a season has no results", async () => {
    renderPage();
    expect(await screen.findByText("No results recorded for this season yet.")).toBeInTheDocument();
  });

  it("falls back to the newest season when the current year has none", async () => {
    vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2025, 2024] });
    renderPage();
    await waitFor(() => expect(endpoints.getStandings).toHaveBeenCalledWith(2025));
    expect(screen.getByRole("button", { name: "2025" })).toHaveClass("active");
  });

  it("loads another season's table when its tab is clicked", async () => {
    vi.mocked(endpoints.getStandings).mockImplementation(async (year) => ({
      year,
      standings: [standingRow({ name: year === 2026 ? "Now" : "Then" })],
    }));
    renderPage();
    expect(await screen.findByText("Now")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(await screen.findByText("Then")).toBeInTheDocument();
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2025" })).toHaveClass("active");
  });

  it("refreshes the table in place every 30 seconds", async () => {
    vi.mocked(endpoints.getStandings).mockResolvedValueOnce({ year: 2026, standings: [standingRow({ name: "Before" })] });
    renderPage();
    expect(await screen.findByText("Before")).toBeInTheDocument();

    vi.mocked(endpoints.getStandings).mockResolvedValue({ year: 2026, standings: [standingRow({ name: "After" })] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(await screen.findByText("After")).toBeInTheDocument();
  });
});
