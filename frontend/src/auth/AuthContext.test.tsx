import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, getAuthToken, setAuthToken } from "../api/client";
import * as endpoints from "../api/endpoints";
import type { Player, User } from "../api/types";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./useAuth";

vi.mock("../api/endpoints");

const user = { id: 1, isAdmin: false } as User;
const player = { id: 10, name: "Robert" } as Player;

// Hands the latest auth state out to the test body (via an effect, not by assigning during render).
let auth: ReturnType<typeof useAuth>;
function Probe({ onAuth }: { onAuth?: (a: ReturnType<typeof useAuth>) => void }) {
  const current = useAuth();
  useEffect(() => {
    onAuth?.(current);
  });
  return <div>{current.loading ? "loading" : current.user ? `user ${current.user.id}` : "anonymous"}</div>;
}
const renderProvider = () =>
  render(
    <AuthProvider>
      <Probe onAuth={(a) => (auth = a)} />
    </AuthProvider>
  );

beforeEach(() => {
  setAuthToken(null);
  vi.mocked(endpoints.fetchMe).mockReset();
  vi.mocked(endpoints.login).mockReset();
});

describe("AuthProvider", () => {
  it("is immediately anonymous, without a request, when there is no stored token", () => {
    renderProvider();
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(endpoints.fetchMe).not.toHaveBeenCalled();
  });

  it("restores the session from a stored token", async () => {
    setAuthToken("stored");
    vi.mocked(endpoints.fetchMe).mockResolvedValue({ user, player });
    renderProvider();
    expect(screen.getByText("loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("user 1")).toBeInTheDocument());
    expect(auth.player).toEqual(player);
  });

  it("drops a token the server rejects", async () => {
    setAuthToken("expired");
    vi.mocked(endpoints.fetchMe).mockRejectedValue(new ApiClientError(401, "Unauthorized"));
    renderProvider();
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(getAuthToken()).toBeNull();
  });

  it("login stores the token and loads the user", async () => {
    vi.mocked(endpoints.login).mockResolvedValue({ token: "fresh", user });
    vi.mocked(endpoints.fetchMe).mockResolvedValue({ user, player });
    renderProvider();
    await act(async () => {
      await auth.login("Robert", "secret");
    });
    expect(endpoints.login).toHaveBeenCalledWith("Robert", "secret");
    expect(getAuthToken()).toBe("fresh");
    expect(screen.getByText("user 1")).toBeInTheDocument();
  });

  it("logout clears the token and the user", async () => {
    setAuthToken("stored");
    vi.mocked(endpoints.fetchMe).mockResolvedValue({ user, player });
    renderProvider();
    await waitFor(() => expect(screen.getByText("user 1")).toBeInTheDocument());
    act(() => auth.logout());
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(getAuthToken()).toBeNull();
  });

  it("useAuth throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useAuth must be used within AuthProvider");
  });
});
