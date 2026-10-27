import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "../api/endpoints";
import { gamedaySummary, standingRow } from "../test/fixtures";
import { Overview } from "./Overview";

vi.mock("../api/endpoints");

let isAdmin = false;
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, isAdmin }, player: { id: 2, name: "Robert" } }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <Overview />
    </MemoryRouter>
  );

const inDays = (n: number) => new Date(Date.parse("2026-10-27T12:00:00Z") + n * 86_400_000).toISOString();

beforeEach(() => {
  isAdmin = false;
  vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z"), toFake: ["Date"] });
  vi.mocked(endpoints.listGamedays).mockResolvedValue({ gamedays: [] });
  vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2026] });
  vi.mocked(endpoints.getStandings).mockResolvedValue({ year: 2026, standings: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Overview", () => {
  it("greets the player by name", async () => {
    renderPage();
    expect(await screen.findByText("Welcome, Robert")).toBeInTheDocument();
  });

  it("shows empty states when nothing is scheduled and nothing has been played", async () => {
    renderPage();
    expect(await screen.findByText("No upcoming matchdays yet.")).toBeInTheDocument();
    expect(await screen.findByText("No results recorded yet.")).toBeInTheDocument();
  });

  it("lists up to three upcoming matchdays, soonest first, skipping cancelled and long-past ones", async () => {
    vi.mocked(endpoints.listGamedays).mockResolvedValue({
      gamedays: [
        gamedaySummary({ id: 1, date: inDays(30) }),
        gamedaySummary({ id: 2, date: inDays(2), confirmedCount: 5, waitlistedCount: 1 }),
        gamedaySummary({ id: 3, date: inDays(9) }),
        gamedaySummary({ id: 4, date: inDays(16) }),
        gamedaySummary({ id: 5, date: inDays(1), status: "CANCELLED" }),
        gamedaySummary({ id: 6, date: inDays(-3) }),
      ],
    });
    renderPage();
    const links = (await screen.findAllByRole("link", { name: /\d+\/12/ })).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/gamedays/2", "/gamedays/3", "/gamedays/4"]);
    expect(screen.getByText("6/12")).toBeInTheDocument();
  });

  it("still shows a matchday that started a few hours ago", async () => {
    vi.mocked(endpoints.listGamedays).mockResolvedValue({
      gamedays: [gamedaySummary({ id: 9, date: new Date(Date.parse("2026-10-27T12:00:00Z") - 3 * 3600_000).toISOString() })],
    });
    renderPage();
    expect(await screen.findByRole("link", { name: /0\/12/ })).toHaveAttribute("href", "/gamedays/9");
  });

  it("shows only the top five of the current season, highlighting the player's own row", async () => {
    vi.mocked(endpoints.getStandings).mockResolvedValue({
      year: 2026,
      standings: Array.from({ length: 7 }, (_, i) =>
        standingRow({ rank: i + 1, playerId: i + 1, name: `P${i + 1}`, points: 30 - i, goalDiff: i === 0 ? 4 : -1 })
      ),
    });
    renderPage();
    expect(await screen.findByText("Season 2026 — Top 5")).toBeInTheDocument();
    expect(screen.getByText("P5")).toBeInTheDocument();
    expect(screen.queryByText("P6")).not.toBeInTheDocument();
    expect(screen.getByText("P2").closest("tr")).toHaveClass("me");
    expect(within(screen.getByText("P1").closest("tr")!).getByText("+4")).toBeInTheDocument();
  });

  it("falls back to the newest season when the current year has no table yet", async () => {
    vi.mocked(endpoints.listSeasons).mockResolvedValue({ seasons: [2025, 2024] });
    renderPage();
    expect(await screen.findByText("Season 2025 — Top 5")).toBeInTheDocument();
    expect(endpoints.getStandings).toHaveBeenCalledWith(2025);
  });

  it("only offers the admin shortcut to admins", async () => {
    renderPage();
    await screen.findByText("Welcome, Robert");
    expect(screen.queryByRole("link", { name: "Create a matchday" })).not.toBeInTheDocument();
  });

  it("lets an admin jump straight to creating a matchday", async () => {
    isAdmin = true;
    renderPage();
    expect(await screen.findByRole("link", { name: "Create a matchday" })).toHaveAttribute("href", "/gamedays?new=1");
  });
});
