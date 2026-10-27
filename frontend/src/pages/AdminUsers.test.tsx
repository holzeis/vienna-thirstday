import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api/client";
import * as endpoints from "../api/endpoints";
import type { Invite, PlayerMerge } from "../api/types";
import { AdminUsers } from "./AdminUsers";

vi.mock("../api/endpoints");

const showToast = vi.fn();
vi.mock("../toast/useToast", () => ({ useToast: () => ({ showToast }) }));

const users = [
  { id: 1, email: "admin@example.com", isAdmin: true, playerId: 10, createdAt: "2026-01-01T00:00:00Z", player: { id: 10, name: "Admin", isGuest: false, addedByUserId: null } },
  { id: 2, email: null, isAdmin: false, playerId: 20, createdAt: "2026-01-02T00:00:00Z", player: { id: 20, name: "Robert", isGuest: false, addedByUserId: null } },
];
const guests = [{ id: 30, name: "Benji", isGuest: true, addedByUserId: null, gamesPlayed: 15, seasons: [2024, 2025] }];

function invite(over: Partial<Invite> = {}): Invite {
  return {
    id: 1, token: "tok1", note: null, guestPlayer: null, season: null, createdBy: null,
    expiresAt: "2026-11-05T12:00:00Z", usedAt: null, usedBy: null, revokedAt: null,
    createdAt: "2026-10-27T12:00:00Z", status: "pending", redemptions: [], ...over,
  };
}

function merge(over: Partial<PlayerMerge> = {}): PlayerMerge {
  return {
    id: 1, guestPlayerName: "Benji", season: null, isPromotion: false, targetPlayer: { id: 20, name: "Robert" },
    mergedBy: { id: 1, name: "Admin" }, undoneAt: null, createdAt: "2026-10-20T12:00:00Z", ...over,
  };
}

function serve(over: { invites?: Invite[]; merges?: PlayerMerge[]; guests?: typeof guests } = {}) {
  vi.mocked(endpoints.adminListUsers).mockResolvedValue({ users });
  vi.mocked(endpoints.adminListGuestPlayers).mockResolvedValue({ guests: over.guests ?? guests });
  vi.mocked(endpoints.adminListMerges).mockResolvedValue({ merges: over.merges ?? [] });
  vi.mocked(endpoints.adminListInvites).mockResolvedValue({ invites: over.invites ?? [] });
}

// The page renders a table and a card list for each section (CSS picks one), so scope to the desktop table.
async function sectionIn(c: HTMLElement, selector: string) {
  await waitFor(() => expect(c.querySelector(selector)).not.toBeNull());
  return within(c.querySelector(selector) as HTMLElement);
}
const usersTable = (c: HTMLElement) => sectionIn(c, ".users-table-wrap");
const invitesTable = (c: HTMLElement) => sectionIn(c, ".invites-table-wrap");

beforeEach(() => {
  showToast.mockReset();
  vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z"), toFake: ["Date"] });
  serve();
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("AdminUsers - inviting", () => {
  it("creates an open invite when no player is selected and shows the link", async () => {
    vi.mocked(endpoints.adminCreateInvite).mockResolvedValue({ invite: invite({ token: "open-tok" }) });
    render(<AdminUsers />);
    fireEvent.click(await screen.findByRole("button", { name: "Create invite link" }));
    expect(await screen.findByText(`${window.location.origin}/invite/open-tok`)).toBeInTheDocument();
    expect(endpoints.adminCreateInvite).toHaveBeenCalledWith({ guestPlayerId: undefined, season: undefined, expiresInDays: 7 });
  });

  it("promotes a whole guest by default", async () => {
    vi.mocked(endpoints.adminCreateInvite).mockResolvedValue({ invite: invite() });
    render(<AdminUsers />);
    fireEvent.change(await screen.findByLabelText("Player", { selector: "#invite-guest" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    await waitFor(() => expect(endpoints.adminCreateInvite).toHaveBeenCalledWith({ guestPlayerId: 30, season: undefined, expiresInDays: 7 }));
  });

  it("can attach a single season of a guest's history instead", async () => {
    vi.mocked(endpoints.adminCreateInvite).mockResolvedValue({ invite: invite() });
    render(<AdminUsers />);
    fireEvent.change(await screen.findByLabelText("Player", { selector: "#invite-guest" }), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Attach history"), { target: { value: "2025" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    await waitFor(() => expect(endpoints.adminCreateInvite).toHaveBeenCalledWith({ guestPlayerId: 30, season: 2025, expiresInDays: 7 }));
  });

  it("offers the season choice only once a guest is selected", async () => {
    render(<AdminUsers />);
    await screen.findByLabelText("Player", { selector: "#invite-guest" });
    expect(screen.queryByLabelText("Attach history")).not.toBeInTheDocument();
  });

  it("clamps the expiry to 1-90 days", async () => {
    vi.mocked(endpoints.adminCreateInvite).mockResolvedValue({ invite: invite() });
    render(<AdminUsers />);
    const days = await screen.findByLabelText("Expires in (days)");
    fireEvent.change(days, { target: { value: "500" } });
    expect(days).toHaveValue(90);
    fireEvent.change(days, { target: { value: "0" } });
    expect(days).toHaveValue(1);
  });

  it("shows the server's error when creating fails", async () => {
    vi.mocked(endpoints.adminCreateInvite).mockRejectedValue(new ApiClientError(400, "Guest already invited"));
    render(<AdminUsers />);
    fireEvent.click(await screen.findByRole("button", { name: "Create invite link" }));
    expect(await screen.findByText("Guest already invited")).toBeInTheDocument();
  });

  it("copies a pending invite's link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    serve({ invites: [invite({ token: "pending-tok" })] });
    const { container } = render(<AdminUsers />);
    fireEvent.click(await (await invitesTable(container)).findByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Link copied to clipboard"));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/pending-tok`);
  });
});

describe("AdminUsers - invite list", () => {
  it("labels each invite by who it is for and shows who joined through it", async () => {
    serve({
      invites: [
        invite({ id: 1 }),
        invite({ id: 2, guestPlayer: { id: 30, name: "Benji" }, season: 2025 }),
        invite({ id: 3, status: "used", redemptions: [{ id: 1, playerId: 20, playerName: "Robert", createdAt: "2026-10-01T00:00:00Z" }] }),
      ],
    });
    const { container } = render(<AdminUsers />);
    const table = await invitesTable(container);
    expect(await table.findAllByText("Open invite")).toHaveLength(2);
    expect(table.getByText("Benji (2025 season only)")).toBeInTheDocument();
    expect(table.getByText("Joined: Robert")).toBeInTheDocument();
    expect(table.getByText("Accepted")).toBeInTheDocument();
  });

  it("revokes a pending invite after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.adminRevokeInvite).mockResolvedValue({ invite: invite() });
    serve({ invites: [invite({ id: 4 })] });
    const { container } = render(<AdminUsers />);
    fireEvent.click(await (await invitesTable(container)).findByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(endpoints.adminRevokeInvite).toHaveBeenCalledWith(4));
  });

  it("does not revoke when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    serve({ invites: [invite({ id: 4 })] });
    const { container } = render(<AdminUsers />);
    fireEvent.click(await (await invitesTable(container)).findByRole("button", { name: "Revoke" }));
    expect(endpoints.adminRevokeInvite).not.toHaveBeenCalled();
  });

  it("only offers 'Remove' for an invite that is no longer pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.adminDeleteInvite).mockResolvedValue(undefined);
    serve({ invites: [invite({ id: 5, status: "expired" })] });
    const { container } = render(<AdminUsers />);
    const table = await invitesTable(container);
    expect(await table.findByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(table.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    fireEvent.click(table.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(endpoints.adminDeleteInvite).toHaveBeenCalledWith(5));
  });
});

describe("AdminUsers - users", () => {
  it("lists users with their email and admin flag", async () => {
    const { container } = render(<AdminUsers />);
    const table = await usersTable(container);
    expect(await table.findByText("admin@example.com")).toBeInTheDocument();
    const boxes = table.getAllByRole("checkbox");
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false]);
  });

  it("grants and revokes admin", async () => {
    vi.mocked(endpoints.adminSetRoles).mockResolvedValue({ user: users[1] });
    const { container } = render(<AdminUsers />);
    const boxes = await (await usersTable(container)).findAllByRole("checkbox");
    fireEvent.click(boxes[1]);
    await waitFor(() => expect(endpoints.adminSetRoles).toHaveBeenCalledWith(2, { isAdmin: true }));
  });

  it("generates a reset link and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.mocked(endpoints.adminGenerateResetLink).mockResolvedValue({ token: "reset-tok", expiresAt: "2026-10-27T13:00:00Z" });
    const { container } = render(<AdminUsers />);
    fireEvent.click((await (await usersTable(container)).findAllByRole("button", { name: "Reset password" }))[1]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Reset link copied to clipboard"));
    expect(endpoints.adminGenerateResetLink).toHaveBeenCalledWith(2);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/reset-password/reset-tok`);
  });

  it("deletes a user after confirmation and names them in the prompt", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.adminDeleteUser).mockResolvedValue(undefined);
    const { container } = render(<AdminUsers />);
    fireEvent.click((await (await usersTable(container)).findAllByRole("button", { name: "Delete" }))[1]);
    await waitFor(() => expect(endpoints.adminDeleteUser).toHaveBeenCalledWith(2));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Robert"));
  });

  it("shows the server's error when an action fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.adminDeleteUser).mockRejectedValue(new ApiClientError(400, "Cannot delete yourself"));
    const { container } = render(<AdminUsers />);
    fireEvent.click((await (await usersTable(container)).findAllByRole("button", { name: "Delete" }))[0]);
    expect(await screen.findByText("Cannot delete yourself")).toBeInTheDocument();
  });
});

describe("AdminUsers - merging guests", () => {
  it("is not offered when there are no guests", async () => {
    serve({ guests: [] });
    render(<AdminUsers />);
    await screen.findByText("Admin: users");
    expect(screen.queryByText("Merge guest history into an account")).not.toBeInTheDocument();
  });

  it("keeps Merge disabled until a guest and a player are chosen", async () => {
    render(<AdminUsers />);
    const merge = await screen.findByRole("button", { name: "Merge" });
    expect(merge).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Guest"), { target: { value: "30" } });
    expect(merge).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Player", { selector: "#merge-target" }), { target: { value: "20" } });
    expect(merge).toBeEnabled();
  });

  it("merges the whole guest into the chosen account after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.adminMergeIntoPlayer).mockResolvedValue({ ok: true });
    render(<AdminUsers />);
    fireEvent.change(await screen.findByLabelText("Guest"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Player", { selector: "#merge-target" }), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(endpoints.adminMergeIntoPlayer).toHaveBeenCalledWith(20, 30, undefined));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Benji's 15 game(s) to Robert"));
  });

  it("merges only one season when chosen", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.adminMergeIntoPlayer).mockResolvedValue({ ok: true });
    render(<AdminUsers />);
    fireEvent.change(await screen.findByLabelText("Guest"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Player", { selector: "#merge-target" }), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Season"), { target: { value: "2024" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(endpoints.adminMergeIntoPlayer).toHaveBeenCalledWith(20, 30, 2024));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("only Benji's 2024 season"));
  });

  it("does nothing if the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminUsers />);
    fireEvent.change(await screen.findByLabelText("Guest"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Player", { selector: "#merge-target" }), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(endpoints.adminMergeIntoPlayer).not.toHaveBeenCalled();
  });
});

describe("AdminUsers - merge history", () => {
  it("lists merges and promotions, marking undone ones without an Undo button", async () => {
    serve({
      merges: [
        merge({ id: 1 }),
        merge({ id: 2, isPromotion: true, guestPlayerName: "Max", targetPlayer: { id: 21, name: "Maximilian" } }),
        merge({ id: 3, undoneAt: "2026-10-21T00:00:00Z", season: 2024 }),
      ],
    });
    render(<AdminUsers />);
    const card = within((await screen.findByText("Recent guest merges")).closest(".card") as HTMLElement);
    expect(card.getAllByText(/merged into/)).toHaveLength(2);
    expect(card.getByText(/promoted to/)).toBeInTheDocument();
    expect(card.getByText("2024 only")).toBeInTheDocument();
    expect(card.getByText(/· undone/)).toBeInTheDocument();
    expect(card.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
  });

  it("undoes a merge after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(endpoints.adminUndoMerge).mockResolvedValue({ guest: guests[0] });
    serve({ merges: [merge({ id: 9 })] });
    render(<AdminUsers />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(endpoints.adminUndoMerge).toHaveBeenCalledWith(9));
  });

  it("words the confirmation differently for undoing a promotion", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    serve({ merges: [merge({ id: 9, isPromotion: true })] });
    render(<AdminUsers />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("promotion"));
    expect(endpoints.adminUndoMerge).not.toHaveBeenCalled();
  });
});
