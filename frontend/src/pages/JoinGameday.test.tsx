import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api/client";
import * as endpoints from "../api/endpoints";
import { publicGameday } from "../test/fixtures";
import { JoinGameday } from "./JoinGameday";

vi.mock("../api/endpoints");

let user: { id: number } | null = null;
const login = vi.fn();
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user, login }) }));

const TOKEN = "share-token";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/join/${TOKEN}`]}>
      <Routes>
        <Route path="/join/:token" element={<JoinGameday />} />
        <Route path="/gamedays/:id" element={<div>gameday page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  user = null;
  login.mockReset();
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(endpoints.getPublicGameday).mockResolvedValue({ gameday: publicGameday() });
  vi.mocked(endpoints.getShareLinkGuestNames).mockResolvedValue({ names: [] });
});

describe("JoinGameday - loading", () => {
  it("shows the date, the roster and the sign-up form for an open matchday", async () => {
    vi.mocked(endpoints.getPublicGameday).mockResolvedValue({
      gameday: publicGameday({
        confirmedCount: 1,
        waitlistedCount: 1,
        confirmed: [{ name: "Robert", isGuest: false }],
        waitlisted: [{ name: "Benji", isGuest: true }],
      }),
    });
    renderPage();
    expect(await screen.findByText("Matchday sign-up")).toBeInTheDocument();
    expect(screen.getByText("Confirmed (1/12)")).toBeInTheDocument();
    expect(screen.getByText("Waitlist (1)")).toBeInTheDocument();
    expect(screen.getByText("Robert")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in and sign up" })).toBeInTheDocument();
  });

  it("says the matchday is waitlist-only once it is full", async () => {
    vi.mocked(endpoints.getPublicGameday).mockResolvedValue({ gameday: publicGameday({ confirmedCount: 12 }) });
    renderPage();
    expect(await screen.findByText(/waitlist only/)).toBeInTheDocument();
  });

  it("shows an error page for an invalid link", async () => {
    vi.mocked(endpoints.getPublicGameday).mockRejectedValue(new ApiClientError(404, "Share link not found"));
    renderPage();
    expect(await screen.findByText("Link unavailable")).toBeInTheDocument();
    expect(screen.getByText("Share link not found")).toBeInTheDocument();
  });

  it("offers no form when the matchday is not open", async () => {
    vi.mocked(endpoints.getPublicGameday).mockResolvedValue({ gameday: publicGameday({ status: "CANCELLED" }) });
    renderPage();
    expect(await screen.findByText(/isn't open for sign-ups/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in and sign up" })).not.toBeInTheDocument();
  });

  it("sends an already logged-in user straight to the matchday page", async () => {
    user = { id: 1 };
    renderPage();
    expect(await screen.findByText("gameday page")).toBeInTheDocument();
  });

  it("suggests existing guest names while signing up as a guest", async () => {
    vi.mocked(endpoints.getShareLinkGuestNames).mockResolvedValue({ names: ["Benji", "Max"] });
    const { container } = renderPage();
    fireEvent.click(await screen.findByText("Sign up as a guest"));
    await waitFor(() => expect(container.querySelectorAll("datalist option")).toHaveLength(2));
  });
});

describe("JoinGameday - logging in", () => {
  async function fillAndSubmit() {
    fireEvent.change(await screen.findByLabelText("Name or email"), { target: { value: "Robert" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in and sign up" }));
  }

  it("logs in, registers for the matchday and goes to its page", async () => {
    login.mockResolvedValue(undefined);
    vi.mocked(endpoints.registerForGameday).mockResolvedValue({ message: "ok" });
    renderPage();
    await fillAndSubmit();
    expect(await screen.findByText("gameday page")).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith("Robert", "secret123");
    expect(endpoints.registerForGameday).toHaveBeenCalledWith(5);
  });

  it("still continues when they were already registered (409)", async () => {
    login.mockResolvedValue(undefined);
    vi.mocked(endpoints.registerForGameday).mockRejectedValue(new ApiClientError(409, "Already registered"));
    renderPage();
    await fillAndSubmit();
    expect(await screen.findByText("gameday page")).toBeInTheDocument();
  });

  it("shows the error and stays here when the login fails", async () => {
    login.mockRejectedValue(new ApiClientError(401, "Invalid credentials"));
    renderPage();
    await fillAndSubmit();
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(endpoints.registerForGameday).not.toHaveBeenCalled();
    expect(screen.queryByText("gameday page")).not.toBeInTheDocument();
  });
});

describe("JoinGameday - guest sign-up", () => {
  async function openGuestForm() {
    fireEvent.click(await screen.findByText("Sign up as a guest"));
    return screen.findByLabelText("Your name");
  }

  it("signs up, remembers the guest in this browser and shows their status", async () => {
    vi.mocked(endpoints.registerGuestViaShareLink).mockResolvedValue({ status: "CONFIRMED", playerId: 77, cancelToken: "cancel-me" });
    vi.mocked(endpoints.getPublicGameday)
      .mockResolvedValueOnce({ gameday: publicGameday() })
      .mockResolvedValue({ gameday: publicGameday({ myStatus: "CONFIRMED", confirmedCount: 1 }) });
    renderPage();
    fireEvent.change(await openGuestForm(), { target: { value: "  Benji " } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText(/You're confirmed/)).toBeInTheDocument();
    expect(endpoints.registerGuestViaShareLink).toHaveBeenCalledWith(TOKEN, "Benji");
    expect(JSON.parse(localStorage.getItem(`vt-share-guest-${TOKEN}`)!)).toEqual({ playerId: 77, cancelToken: "cancel-me" });
    expect(endpoints.getPublicGameday).toHaveBeenLastCalledWith(TOKEN, 77);
  });

  it("explains the waitlist to a waitlisted guest", async () => {
    vi.mocked(endpoints.registerGuestViaShareLink).mockResolvedValue({ status: "WAITLISTED", playerId: 77, cancelToken: "c" });
    vi.mocked(endpoints.getPublicGameday)
      .mockResolvedValueOnce({ gameday: publicGameday() })
      .mockResolvedValue({ gameday: publicGameday({ myStatus: "WAITLISTED" }) });
    renderPage();
    fireEvent.change(await openGuestForm(), { target: { value: "Benji" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByText(/You're on the waitlist/)).toBeInTheDocument();
    expect(screen.getByText(/only confirmed in pairs/)).toBeInTheDocument();
  });

  it("shows the server's message, e.g. when that name is already taken", async () => {
    vi.mocked(endpoints.registerGuestViaShareLink).mockRejectedValue(new ApiClientError(409, "Already signed up"));
    renderPage();
    fireEvent.change(await openGuestForm(), { target: { value: "Benji" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByText("Already signed up")).toBeInTheDocument();
  });

  it("can switch back to logging in", async () => {
    renderPage();
    await openGuestForm();
    fireEvent.click(screen.getByText("Log in instead"));
    expect(await screen.findByLabelText("Name or email")).toBeInTheDocument();
  });
});

describe("JoinGameday - returning guest", () => {
  beforeEach(() => {
    localStorage.setItem(`vt-share-guest-${TOKEN}`, JSON.stringify({ playerId: 77, cancelToken: "cancel-me" }));
    vi.mocked(endpoints.getPublicGameday).mockResolvedValue({ gameday: publicGameday({ myStatus: "CONFIRMED" }) });
  });

  it("recognises the guest from this browser and asks the server for their status", async () => {
    renderPage();
    expect(await screen.findByText(/You're confirmed/)).toBeInTheDocument();
    expect(endpoints.getPublicGameday).toHaveBeenCalledWith(TOKEN, 77);
  });

  it("lets them cancel their spot, then forgets them and shows the form again", async () => {
    vi.mocked(endpoints.cancelGuestViaShareLink).mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel my spot" }));
    vi.mocked(endpoints.getPublicGameday).mockResolvedValue({ gameday: publicGameday({ myStatus: null }) });

    expect(await screen.findByRole("button", { name: "Log in and sign up" })).toBeInTheDocument();
    expect(endpoints.cancelGuestViaShareLink).toHaveBeenCalledWith(TOKEN, 77, "cancel-me");
    expect(localStorage.getItem(`vt-share-guest-${TOKEN}`)).toBeNull();
  });

  it("shows the error and keeps the spot when cancelling fails", async () => {
    vi.mocked(endpoints.cancelGuestViaShareLink).mockRejectedValue(new ApiClientError(403, "Not allowed"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel my spot" }));
    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(localStorage.getItem(`vt-share-guest-${TOKEN}`)).not.toBeNull();
  });

  it("shows no cancel button for a legacy remembered guest without a cancel token", async () => {
    localStorage.setItem(`vt-share-guest-${TOKEN}`, "77");
    renderPage();
    expect(await screen.findByText(/You're confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel my spot" })).not.toBeInTheDocument();
  });
});
