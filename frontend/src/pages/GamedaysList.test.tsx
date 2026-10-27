import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api/client";
import * as endpoints from "../api/endpoints";
import { gamedaySummary } from "../test/fixtures";
import { GamedaysList } from "./GamedaysList";

vi.mock("../api/endpoints");

let isAdmin = false;
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: { id: 1, isAdmin } }) }));

const local = (y: number, mo: number, d: number, h = 19) => new Date(y, mo - 1, d, h).toISOString();

function renderPage(path = "/gamedays") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/gamedays" element={<GamedaysList />} />
        <Route path="/gamedays/:id" element={<div>detail page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  isAdmin = false;
  vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z"), toFake: ["Date"] });
  vi.mocked(endpoints.listGamedays).mockResolvedValue({ gamedays: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("GamedaysList", () => {
  it("says so when there are no matchdays", async () => {
    renderPage();
    expect(await screen.findByText("No matchdays yet.")).toBeInTheDocument();
  });

  it("lists the current year's matchdays newest first, with score, status and player count", async () => {
    vi.mocked(endpoints.listGamedays).mockResolvedValue({
      gamedays: [
        gamedaySummary({ id: 1, matchday: 1, date: local(2026, 10, 8), status: "COMPLETED", result: { teamAScore: 5, teamBScore: 3 }, confirmedCount: 10, maxPlayers: 12 }),
        gamedaySummary({ id: 2, matchday: 2, date: local(2026, 10, 15), status: "OPEN", confirmedCount: 6, waitlistedCount: 1, maxPlayers: 12 }),
      ],
    });
    renderPage();

    const rows = await screen.findAllByRole("row");
    // header + 2 rows, newest (matchday 2) first
    expect(within(rows[1]).getByText("15.10. 19:00")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Open")).toBeInTheDocument();
    expect(within(rows[1]).getByText("7/12")).toBeInTheDocument();
    expect(within(rows[1]).getByText("—")).toBeInTheDocument();
    expect(within(rows[2]).getByText("5:3")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Done")).toBeInTheDocument();
  });

  it("marks the matchdays the logged-in player took part in", async () => {
    vi.mocked(endpoints.listGamedays).mockResolvedValue({
      gamedays: [gamedaySummary({ id: 1, played: true }), gamedaySummary({ id: 2, played: false, date: local(2026, 10, 1) })],
    });
    renderPage();
    await screen.findAllByRole("row");
    expect(screen.getAllByLabelText("You played")).toHaveLength(1);
  });

  it("opens a matchday when its row is clicked", async () => {
    vi.mocked(endpoints.listGamedays).mockResolvedValue({ gamedays: [gamedaySummary({ id: 7 })] });
    renderPage();
    fireEvent.click((await screen.findAllByRole("row"))[1]);
    expect(await screen.findByText("detail page")).toBeInTheDocument();
  });

  it("derives year tabs from the matchdays themselves, so a season with only upcoming games still shows", async () => {
    vi.mocked(endpoints.listGamedays).mockResolvedValue({
      gamedays: [gamedaySummary({ id: 1, date: local(2026, 11, 5) }), gamedaySummary({ id: 2, date: local(2025, 6, 5) })],
    });
    renderPage();
    expect(await screen.findByRole("button", { name: "2026" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "2025" })).not.toHaveClass("active");
    expect(screen.getByText("05.11. 19:00")).toBeInTheDocument();
    expect(screen.queryByText("05.06. 19:00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(screen.getByText("05.06. 19:00")).toBeInTheDocument();
    expect(screen.queryByText("05.11. 19:00")).not.toBeInTheDocument();
  });

  it("defaults to the newest year with matchdays when the current year has none", async () => {
    vi.mocked(endpoints.listGamedays).mockResolvedValue({ gamedays: [gamedaySummary({ date: local(2025, 6, 5) })] });
    renderPage();
    expect(await screen.findByRole("button", { name: "2025" })).toHaveClass("active");
  });

  it("falls back to an empty list if loading fails", async () => {
    vi.mocked(endpoints.listGamedays).mockRejectedValue(new ApiClientError(500, "boom"));
    renderPage();
    expect(await screen.findByText("No matchdays yet.")).toBeInTheDocument();
  });

  describe("creating a matchday", () => {
    it("is not offered to non-admins", async () => {
      renderPage();
      await screen.findByText("No matchdays yet.");
      expect(screen.queryByRole("button", { name: "+ New matchday" })).not.toBeInTheDocument();
    });

    it("lets an admin open the form, create one and refreshes the list", async () => {
      isAdmin = true;
      vi.mocked(endpoints.createGameday).mockResolvedValue({ gameday: {} as never });
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "+ New matchday" }));
      fireEvent.change(screen.getByLabelText(/Date & time/), { target: { value: "2026-11-05T19:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Create matchday" }));

      await waitFor(() => expect(endpoints.createGameday).toHaveBeenCalledTimes(1));
      expect(vi.mocked(endpoints.createGameday).mock.calls[0][0].date).toBe(new Date("2026-11-05T19:00").toISOString());
      // the form closes and the list is reloaded
      await waitFor(() => expect(screen.queryByText("New matchday")).not.toBeInTheDocument());
      expect(endpoints.listGamedays).toHaveBeenCalledTimes(2);
    });

    it("opens the form straight away for ?new=1", async () => {
      isAdmin = true;
      renderPage("/gamedays?new=1");
      expect(await screen.findByRole("button", { name: "Create matchday" })).toBeInTheDocument();
    });

    it("shows the server's error and keeps the form open", async () => {
      isAdmin = true;
      vi.mocked(endpoints.createGameday).mockRejectedValue(new ApiClientError(400, "Date is in the past"));
      renderPage("/gamedays?new=1");
      fireEvent.click(await screen.findByRole("button", { name: "Create matchday" }));
      expect(await screen.findByText("Date is in the past")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create matchday" })).toBeEnabled();
    });
  });
});
