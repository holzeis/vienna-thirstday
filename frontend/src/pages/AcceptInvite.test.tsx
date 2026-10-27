import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, getAuthToken, setAuthToken } from "../api/client";
import * as endpoints from "../api/endpoints";
import { AcceptInvite } from "./AcceptInvite";

vi.mock("../api/endpoints");

const refresh = vi.fn();
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ refresh }) }));

function renderPage(path = "/invite/abc") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/invite" element={<AcceptInvite />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function fill(name: string, password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirm } });
}

beforeEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
  vi.mocked(endpoints.getInvite).mockResolvedValue({ guest: null });
});

describe("AcceptInvite", () => {
  it("greets an open invite with an empty name to pick", async () => {
    renderPage();
    expect(await screen.findByText("You're invited")).toBeInTheDocument();
    expect(screen.getByText(/Pick a name/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("prefills the name of the guest a guest-linked invite is for", async () => {
    vi.mocked(endpoints.getInvite).mockResolvedValue({ guest: { id: 3, name: "Benji" } });
    renderPage();
    expect(await screen.findByText(/Confirm or change your name/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Benji"));
  });

  it("explains why an invite is unusable", async () => {
    vi.mocked(endpoints.getInvite).mockRejectedValue(new ApiClientError(410, "This invite has expired"));
    renderPage();
    expect(await screen.findByText("Invite not available")).toBeInTheDocument();
    expect(screen.getByText("This invite has expired")).toBeInTheDocument();
  });

  it("rejects a link without a token without asking the server", () => {
    renderPage("/invite");
    expect(screen.getByText("This invite link is missing its token.")).toBeInTheDocument();
    expect(endpoints.getInvite).not.toHaveBeenCalled();
  });

  it("creates the account, stores the session token and goes home", async () => {
    vi.mocked(endpoints.acceptInvite).mockResolvedValue({ token: "new-token", user: {} as never });
    renderPage();
    await screen.findByText("You're invited");
    fill("Robert", "password123");
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: " r@example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Join Vienna Thirstday" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
    expect(endpoints.acceptInvite).toHaveBeenCalledWith("abc", { name: "Robert", password: "password123", email: "r@example.com", avatar: undefined });
    expect(getAuthToken()).toBe("new-token");
    expect(refresh).toHaveBeenCalled();
  });

  it("omits a blank email", async () => {
    vi.mocked(endpoints.acceptInvite).mockResolvedValue({ token: "t", user: {} as never });
    renderPage();
    await screen.findByText("You're invited");
    fill("Robert", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Join Vienna Thirstday" }));
    await waitFor(() => expect(endpoints.acceptInvite).toHaveBeenCalled());
    expect(vi.mocked(endpoints.acceptInvite).mock.calls[0][1].email).toBeUndefined();
  });

  it("refuses mismatched passwords without calling the server", async () => {
    renderPage();
    await screen.findByText("You're invited");
    fill("Robert", "password123", "password124");
    fireEvent.click(screen.getByRole("button", { name: "Join Vienna Thirstday" }));
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(endpoints.acceptInvite).not.toHaveBeenCalled();
  });

  it("shows the server's error, e.g. a name that is already taken", async () => {
    vi.mocked(endpoints.acceptInvite).mockRejectedValue(new ApiClientError(409, "That name is taken"));
    renderPage();
    await screen.findByText("You're invited");
    fill("Robert", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Join Vienna Thirstday" }));
    expect(await screen.findByText("That name is taken")).toBeInTheDocument();
    expect(getAuthToken()).toBeNull();
  });
});
