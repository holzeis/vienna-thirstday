import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api/client";
import * as endpoints from "../api/endpoints";
import { gamedayDetail, registration, standingRow } from "../test/fixtures";
import { GamedayDetail } from "./GamedayDetail";

vi.mock("../api/endpoints");

let isAdmin = false;
const showToast = vi.fn();
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, isAdmin }, player: { id: 10 } }),
}));
vi.mock("../toast/useToast", () => ({ useToast: () => ({ showToast }) }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/gamedays/5"]}>
      <Routes>
        <Route path="/gamedays/:id" element={<GamedayDetail />} />
        <Route path="/gamedays" element={<div>list page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const PAST = "2026-10-20T17:00:00.000Z";

function serve(detail = gamedayDetail()) {
  vi.mocked(endpoints.getGameday).mockResolvedValue({ gameday: detail });
}

beforeEach(() => {
  isAdmin = false;
  showToast.mockReset();
  vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z"), toFake: ["Date"] });
  vi.mocked(endpoints.listGuests).mockResolvedValue({ guests: [] });
  vi.mocked(endpoints.getGamedayShareLink).mockResolvedValue({ shareToken: "tok" });
  vi.mocked(endpoints.getStandings).mockResolvedValue({ year: 2026, standings: [] });
  serve();
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("GamedayDetail - roster", () => {
  it("splits registrations into confirmed, waitlist and unavailable", async () => {
    serve(
      gamedayDetail({
        registrations: [
          registration(1, "Robert", "CONFIRMED"),
          registration(2, "Benji", "WAITLISTED"),
          registration(3, "Max", "UNAVAILABLE"),
        ],
      })
    );
    renderPage();
    expect(await screen.findByText("Confirmed (1/12)")).toBeInTheDocument();
    expect(screen.getByText("Waitlist (1)")).toBeInTheDocument();
    expect(screen.getByText("Unavailable (1)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Robert" })).toHaveAttribute("href", "/players/10");
  });

  it("flags guests and electors", async () => {
    serve(gamedayDetail({ registrations: [registration(1, "Benji", "CONFIRMED", { isGuest: true }), registration(2, "Robert", "CONFIRMED", { electorRank: 1 })] }));
    renderPage();
    expect(await screen.findByText("Guest")).toBeInTheDocument();
    expect(screen.getByTitle("Elector - picks first")).toBeInTheDocument();
  });

  it("hides the roster of a completed matchday and shows the result instead", async () => {
    serve(
      gamedayDetail({
        status: "COMPLETED",
        date: PAST,
        result: {
          id: 1,
          teamAScore: 5,
          teamBScore: 3,
          playerStats: [
            { id: 1, team: "A", points: 4, goalDiff: 2, player: { id: 10, name: "Robert", isGuest: false } },
            { id: 2, team: "B", points: 1, goalDiff: -2, player: { id: 20, name: "Benji", isGuest: false } },
          ],
        } as never,
      })
    );
    renderPage();
    expect(await screen.findByText("Result")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("4 pts")).toBeInTheDocument();
    expect(screen.queryByText(/^Confirmed/)).not.toBeInTheDocument();
  });

  it("shows the forecast when there is one", async () => {
    serve(
      gamedayDetail({
        weather: {
          kind: "FORECAST", condition: "sunny", temperatureC: 18, feelsLikeC: null, windSpeedKmh: 5, windGustsKmh: null,
          isWindy: false, precipitationMm: 0, precipitationProbability: 10, fetchedAt: "2026-10-27T10:00:00Z",
        },
      })
    );
    renderPage();
    expect(await screen.findByText(/Sunny, 18°C/)).toBeInTheDocument();
  });
});

describe("GamedayDetail - signing up", () => {
  it("offers 'I'm in' and registers, then reloads", async () => {
    vi.mocked(endpoints.registerForGameday).mockResolvedValue({ message: "ok" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "I'm in" }));
    await waitFor(() => expect(endpoints.registerForGameday).toHaveBeenCalledWith(5));
    await waitFor(() => expect(endpoints.getGameday).toHaveBeenCalledTimes(2));
  });

  it("lets a player mark themselves unavailable", async () => {
    vi.mocked(endpoints.markUnavailableForGameday).mockResolvedValue({ message: "ok" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "I'm out" }));
    await waitFor(() => expect(endpoints.markUnavailableForGameday).toHaveBeenCalledWith(5));
  });

  it("shows the server's error when registering fails", async () => {
    vi.mocked(endpoints.registerForGameday).mockRejectedValue(new ApiClientError(409, "Registration is closed"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "I'm in" }));
    expect(await screen.findByText("Registration is closed")).toBeInTheDocument();
  });

  it.each([
    ["CONFIRMED", "✓ You're in"],
    ["WAITLISTED", "⏳ You're waitlisted"],
    ["UNAVAILABLE", "🚫 You're out"],
  ] as const)("shows %s status instead of the buttons once already registered", async (status, text) => {
    serve(gamedayDetail({ registrations: [registration(1, "Me", status, { playerId: 10 })] }));
    renderPage();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm in" })).not.toBeInTheDocument();
  });

  it("explains the waitlist to a waitlisted player", async () => {
    serve(gamedayDetail({ registrations: [registration(1, "Me", "WAITLISTED", { playerId: 10 })] }));
    renderPage();
    expect(await screen.findByText(/only confirmed in pairs/)).toBeInTheDocument();
  });

  it("offers no sign-up on a matchday that is not open", async () => {
    serve(gamedayDetail({ status: "CANCELLED" }));
    renderPage();
    await screen.findByText(/Unavailable/);
    expect(screen.queryByRole("button", { name: "I'm in" })).not.toBeInTheDocument();
  });
});

describe("GamedayDetail - guests", () => {
  it("creates a guest and signs them up", async () => {
    vi.mocked(endpoints.createGuest).mockResolvedValue({ guest: { id: 99, name: "Benji", isGuest: true, addedByUserId: 1 } });
    vi.mocked(endpoints.registerForGameday).mockResolvedValue({ message: "ok" });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Guest name"), { target: { value: "  Benji " } });
    fireEvent.click(screen.getByRole("button", { name: "Add guest" }));
    await waitFor(() => expect(endpoints.registerForGameday).toHaveBeenCalledWith(5, 99));
    expect(endpoints.createGuest).toHaveBeenCalledWith("Benji");
  });

  it("does not suggest a guest who is already signed up", async () => {
    vi.mocked(endpoints.listGuests).mockResolvedValue({
      guests: [
        { id: 1, name: "Already In", isGuest: true, addedByUserId: null },
        { id: 2, name: "Free Guest", isGuest: true, addedByUserId: null },
      ],
    });
    serve(gamedayDetail({ registrations: [registration(1, "Already In", "CONFIRMED", { playerId: 1, isGuest: true })] }));
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll("#guest-options option")).toHaveLength(1));
    expect(container.querySelector("#guest-options option")).toHaveAttribute("value", "Free Guest");
  });

  it("keeps 'Add guest' disabled for a blank name", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Add guest" })).toBeDisabled();
  });
});

describe("GamedayDetail - cancelling registrations", () => {
  it("lets an admin cancel anyone's registration", async () => {
    isAdmin = true;
    vi.mocked(endpoints.cancelRegistration).mockResolvedValue(undefined);
    serve(gamedayDetail({ registrations: [registration(7, "Benji", "CONFIRMED", { registeredById: 99 })] }));
    renderPage();
    const item = (await screen.findByRole("link", { name: "Benji" })).closest("li")!;
    fireEvent.click(within(item).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(endpoints.cancelRegistration).toHaveBeenCalledWith(5, 7));
  });

  it("only lets a regular player cancel registrations they made themselves", async () => {
    serve(
      gamedayDetail({
        registrations: [
          registration(1, "Mine", "CONFIRMED", { registeredById: 1 }),
          registration(2, "Theirs", "CONFIRMED", { registeredById: 99 }),
        ],
      })
    );
    renderPage();
    const mine = (await screen.findByRole("link", { name: "Mine" })).closest("li")!;
    const theirs = screen.getByRole("link", { name: "Theirs" }).closest("li")!;
    expect(within(mine).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("GamedayDetail - sharing", () => {
  it("copies the sign-up link and confirms with a toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderPage();
    await waitFor(() => expect(endpoints.getGamedayShareLink).toHaveBeenCalledWith(5));
    await waitFor(() => screen.getByLabelText("Copy sign-up link"));
    fireEvent.click(screen.getByLabelText("Copy sign-up link"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Link copied to clipboard"));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/tok`);
  });

  it("is not offered once the matchday is no longer open", async () => {
    serve(gamedayDetail({ status: "CANCELLED" }));
    renderPage();
    await screen.findByText(/Unavailable/);
    expect(screen.queryByLabelText("Copy sign-up link")).not.toBeInTheDocument();
    expect(endpoints.getGamedayShareLink).not.toHaveBeenCalled();
  });
});

describe("GamedayDetail - admin actions", () => {
  beforeEach(() => {
    isAdmin = true;
  });

  it("cancels an open matchday after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.cancelGameday).mockResolvedValue({ gameday: gamedayDetail() });
    renderPage();
    fireEvent.click(await screen.findByLabelText("Cancel matchday"));
    await waitFor(() => expect(endpoints.cancelGameday).toHaveBeenCalledWith(5));
  });

  it("does nothing if the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByLabelText("Cancel matchday"));
    expect(endpoints.cancelGameday).not.toHaveBeenCalled();
  });

  it("can revert a cancellation while the matchday is still ahead", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.uncancelGameday).mockResolvedValue({ gameday: gamedayDetail() });
    serve(gamedayDetail({ status: "CANCELLED" }));
    renderPage();
    fireEvent.click(await screen.findByLabelText("Revert cancellation"));
    await waitFor(() => expect(endpoints.uncancelGameday).toHaveBeenCalledWith(5));
  });

  it("cannot revert a cancellation once the date has passed", async () => {
    serve(gamedayDetail({ status: "CANCELLED", date: PAST }));
    renderPage();
    await screen.findByLabelText("Delete matchday");
    expect(screen.queryByLabelText("Revert cancellation")).not.toBeInTheDocument();
  });

  it("deletes a matchday and returns to the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.deleteGameday).mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByLabelText("Delete matchday"));
    expect(await screen.findByText("list page")).toBeInTheDocument();
    expect(endpoints.deleteGameday).toHaveBeenCalledWith(5);
  });

  it("is hidden from regular players", async () => {
    isAdmin = false;
    renderPage();
    await screen.findByText(/Unavailable/);
    expect(screen.queryByLabelText("Delete matchday")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cancel matchday")).not.toBeInTheDocument();
  });
});

describe("GamedayDetail - teams (admin)", () => {
  const regs = [
    registration(1, "Low", "CONFIRMED", { playerId: 1 }),
    registration(2, "Top", "CONFIRMED", { playerId: 2 }),
    registration(3, "Mid", "CONFIRMED", { playerId: 3 }),
    registration(4, "Unranked", "CONFIRMED", { playerId: 4 }),
  ];
  // Names also appear in the roster above, so look inside the Teams card only.
  const teamSelect = (name: string) =>
    within(screen.getByText("Teams").closest(".card") as HTMLElement).getByText(name).closest("tr")!.querySelector("select") as HTMLSelectElement;
  const teamOf = (name: string) => teamSelect(name).value;

  beforeEach(() => {
    isAdmin = true;
    serve(gamedayDetail({ registrations: regs }));
    vi.mocked(endpoints.getStandings).mockResolvedValue({
      year: 2026,
      standings: [
        standingRow({ playerId: 2, rank: 1 }),
        standingRow({ playerId: 3, rank: 2 }),
        standingRow({ playerId: 1, rank: 3 }),
      ],
    });
  });

  it("auto-assigns alternating teams by season rank, unranked players last, without saving", async () => {
    renderPage();
    const auto = await screen.findByRole("button", { name: "Auto-assign by rank" });
    await waitFor(() => expect(auto).toBeEnabled());
    fireEvent.click(auto);
    expect([teamOf("Top"), teamOf("Mid"), teamOf("Low"), teamOf("Unranked")]).toEqual(["A", "B", "A", "B"]);
    expect(endpoints.setTeams).not.toHaveBeenCalled();
  });

  it("saves only the players that were given a team", async () => {
    vi.mocked(endpoints.setTeams).mockResolvedValue({ message: "ok" });
    renderPage();
    await screen.findByRole("button", { name: "Save teams" });
    fireEvent.change(teamSelect("Top"), { target: { value: "A" } });
    fireEvent.change(teamSelect("Mid"), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save teams" }));
    await waitFor(() =>
      expect(endpoints.setTeams).toHaveBeenCalledWith(5, [
        { playerId: 2, team: "A" },
        { playerId: 3, team: "B" },
      ])
    );
  });

  it("only lists confirmed players for team selection", async () => {
    serve(gamedayDetail({ registrations: [registration(1, "In", "CONFIRMED"), registration(2, "Waiting", "WAITLISTED")] }));
    renderPage();
    const teams = (await screen.findByText("Teams")).closest(".card")!;
    expect(within(teams as HTMLElement).getByText("In")).toBeInTheDocument();
    expect(within(teams as HTMLElement).queryByText("Waiting")).not.toBeInTheDocument();
  });
});

describe("GamedayDetail - result entry (admin)", () => {
  beforeEach(() => {
    isAdmin = true;
  });

  it("is not offered before kickoff", async () => {
    renderPage();
    await screen.findByText("Teams");
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("saves the score once the game has happened, treating a blank field as 0 and stripping non-digits", async () => {
    vi.mocked(endpoints.setResult).mockResolvedValue({ message: "ok" });
    serve(gamedayDetail({ date: PAST, status: "CLOSED" }));
    renderPage();
    await screen.findByText("Result");
    const [a, b] = screen.getAllByRole("textbox");
    fireEvent.change(a, { target: { value: "5x" } });
    expect(a).toHaveValue("5");
    expect(b).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));
    await waitFor(() => expect(endpoints.setResult).toHaveBeenCalledWith(5, 5, 0));
  });

  it("shows the server's error when saving fails", async () => {
    vi.mocked(endpoints.setResult).mockRejectedValue(new ApiClientError(400, "Teams are not set"));
    serve(gamedayDetail({ date: PAST, status: "CLOSED" }));
    renderPage();
    await screen.findByText("Result");
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));
    expect(await screen.findByText("Teams are not set")).toBeInTheDocument();
  });
});
