import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api/client";
import * as endpoints from "../api/endpoints";
import type { PlayerProfile as Profile } from "../api/types";
import * as push from "../push";
import { noForm } from "../test/fixtures";
import { PlayerProfile } from "./PlayerProfile";

vi.mock("../api/endpoints");
vi.mock("../push");

let me: { id: number } | null = { id: 7 };
const refresh = vi.fn();
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: me ? { id: 1, email: "me@example.com" } : null, player: me, refresh }),
}));

function profile(over: Partial<Profile> = {}): Profile {
  return {
    player: { id: 7, name: "Robert", isGuest: false, isAdmin: false, avatarDataUri: null, joinedAt: "2025-03-10T00:00:00Z" },
    awards: [],
    currentForm: noForm,
    onFireStreak: null,
    isNewcomer: false,
    teammates: { favorite: null, unfavorite: null, mostPlayedWith: null, dreamTeam: null },
    nemesis: null,
    favoriteVictim: null,
    ...over,
  };
}

const teammate = { playerId: 8, name: "Benji", sharedGames: 5, sharedWins: 4, sharedLosses: 1, avatarDataUri: null };

function renderPage(id = 7) {
  return render(
    <MemoryRouter initialEntries={[`/players/${id}`]}>
      <Routes>
        <Route path="/players/:id" element={<PlayerProfile />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  me = { id: 7 };
  vi.mocked(endpoints.getPlayerProfile).mockResolvedValue(profile());
  vi.mocked(push.isPushSupported).mockReturnValue(false);
  vi.mocked(push.getExistingPushSubscription).mockResolvedValue(null);
});

describe("PlayerProfile - header", () => {
  it("shows the name, join month and guest/admin badges", async () => {
    vi.mocked(endpoints.getPlayerProfile).mockResolvedValue(
      profile({ player: { id: 7, name: "Robert", isGuest: true, isAdmin: true, avatarDataUri: null, joinedAt: "2025-03-10T00:00:00Z" } })
    );
    renderPage();
    expect(await screen.findByText("Robert")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText(/Joined .*2025/)).toBeInTheDocument();
    expect(endpoints.getPlayerProfile).toHaveBeenCalledWith(7);
  });

  it("falls back to an initial when there is no photo", async () => {
    renderPage();
    expect(await screen.findByText("R")).toHaveClass("player-avatar-placeholder");
  });
});

describe("PlayerProfile - locker room", () => {
  it("shows an empty state when there is nothing to report yet", async () => {
    renderPage();
    expect(await screen.findByText(/Form and teammate chemistry will show up here/)).toBeInTheDocument();
  });

  it("shows form tiles for the flags that are set", async () => {
    vi.mocked(endpoints.getPlayerProfile).mockResolvedValue(
      profile({ currentForm: { ...noForm, veteran: true, ghost: true }, isNewcomer: true, onFireStreak: 4 })
    );
    renderPage();
    expect(await screen.findByText("Veteran")).toBeInTheDocument();
    expect(screen.getByText("Ghost")).toBeInTheDocument();
    expect(screen.getByText("Newcomer")).toBeInTheDocument();
    expect(screen.getByText("4 wins in a row")).toBeInTheDocument();
    expect(screen.queryByText("Undefeated")).not.toBeInTheDocument();
  });

  it("shows teammate and opponent tiles with their stats, linked to the other player", async () => {
    vi.mocked(endpoints.getPlayerProfile).mockResolvedValue(
      profile({
        teammates: { favorite: teammate, unfavorite: null, mostPlayedWith: null, dreamTeam: { ...teammate, sharedGames: 4, sharedWins: 3 } },
        nemesis: { playerId: 9, name: "Max", gamesAgainst: 5, lossesAgainst: 4, winsAgainst: 1, avatarDataUri: null },
      })
    );
    renderPage();
    expect(await screen.findByText("Lucky Charm")).toBeInTheDocument();
    expect(screen.getByText("4 wins in last 5")).toBeInTheDocument();
    expect(screen.getByText("75% win rate this season")).toBeInTheDocument();
    expect(screen.getByText("4 losses to them in last 5")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Benji" })[0]).toHaveAttribute("href", "/players/8");
    expect(screen.getByRole("link", { name: "Max" })).toHaveAttribute("href", "/players/9");
  });
});

describe("PlayerProfile - awards", () => {
  it("lists awards with tier and, for season awards, the year", async () => {
    vi.mocked(endpoints.getPlayerProfile).mockResolvedValue(
      profile({
        awards: [
          { category: "wins", tier: "gold", kind: "personal", value: 42 },
          { category: "ranking", tier: "silver", kind: "season", season: 2025, value: 2 },
        ],
      })
    );
    renderPage();
    expect(await screen.findByText("Wins")).toBeInTheDocument();
    expect(screen.getByText("Season Ranking · 2025")).toBeInTheDocument();
    expect(screen.getByText("gold")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

describe("PlayerProfile - own vs. someone else's profile", () => {
  it("offers photo upload, settings and push controls on your own profile only", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "📷 Add photo" })).toBeInTheDocument();
    expect(screen.getByText("Account Settings")).toBeInTheDocument();
  });

  it("hides them on another player's profile", async () => {
    me = { id: 99 };
    renderPage();
    await screen.findByText("Robert");
    expect(screen.queryByRole("button", { name: /photo/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Account Settings")).not.toBeInTheDocument();
  });

  it("uploads a chosen photo and reloads the profile", async () => {
    vi.mocked(endpoints.uploadAvatar).mockResolvedValue(undefined as never);
    const { container } = renderPage();
    await screen.findByRole("button", { name: "📷 Add photo" });
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(endpoints.uploadAvatar).toHaveBeenCalledWith(7, file));
    await waitFor(() => expect(endpoints.getPlayerProfile).toHaveBeenCalledTimes(2));
  });

  it("shows the server's message when the upload is rejected", async () => {
    vi.mocked(endpoints.uploadAvatar).mockRejectedValue(new ApiClientError(413, "Image too large"));
    const { container } = renderPage();
    await screen.findByRole("button", { name: "📷 Add photo" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "me.png")] } });
    expect(await screen.findByText("Image too large")).toBeInTheDocument();
  });
});

describe("PlayerProfile - account settings", () => {
  async function openSettings() {
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  }

  it("sends only the fields that changed", async () => {
    vi.mocked(endpoints.updateMe).mockResolvedValue({ user: {} as never, player: null });
    renderPage();
    await openSettings();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Rob " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(endpoints.updateMe).toHaveBeenCalledWith({ name: "Rob" });
    expect(refresh).toHaveBeenCalled();
  });

  it("sends the current password along with a new one", async () => {
    vi.mocked(endpoints.updateMe).mockResolvedValue({ user: {} as never, player: null });
    renderPage();
    await openSettings();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(endpoints.updateMe).toHaveBeenCalledWith({ currentPassword: "old-password", newPassword: "new-password-1" }));
  });

  it("shows the server's error, e.g. a wrong current password", async () => {
    vi.mocked(endpoints.updateMe).mockRejectedValue(new ApiClientError(400, "Current password is incorrect"));
    renderPage();
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });

  it("links to the privacy policy", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "Privacy Policy" })).toHaveAttribute("target", "_blank");
  });
});

describe("PlayerProfile - push notifications", () => {
  it("explains the unsupported case without offering a toggle", async () => {
    renderPage();
    expect(await screen.findByText("Not supported on this browser/device.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
  });

  it("enables notifications", async () => {
    vi.mocked(push.isPushSupported).mockReturnValue(true);
    vi.mocked(push.enablePushNotifications).mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    expect(await screen.findByRole("button", { name: "Disable" })).toBeInTheDocument();
  });

  it("shows Disable straight away when already subscribed, and turns them off", async () => {
    vi.mocked(push.isPushSupported).mockReturnValue(true);
    vi.mocked(push.getExistingPushSubscription).mockResolvedValue({} as PushSubscription);
    vi.mocked(push.disablePushNotifications).mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("shows why enabling failed, e.g. permission denied", async () => {
    vi.mocked(push.isPushSupported).mockReturnValue(true);
    vi.mocked(push.enablePushNotifications).mockRejectedValue(new Error("Notification permission was not granted."));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    expect(await screen.findByText("Notification permission was not granted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });
});
