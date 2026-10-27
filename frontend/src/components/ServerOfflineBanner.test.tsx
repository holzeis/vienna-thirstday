import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../api/client";
import { ServerOfflineBanner } from "./ServerOfflineBanner";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } })));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ServerOfflineBanner", () => {
  it("stays hidden while the server answers", async () => {
    await act(async () => {
      render(<ServerOfflineBanner />);
    });
    expect(screen.queryByText(/Can't reach the server/)).not.toBeInTheDocument();
  });

  it("appears when a health check gets no response, and clears once the server is back", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => {
      render(<ServerOfflineBanner />);
    });
    expect(screen.getByText(/Can't reach the server/)).toBeInTheDocument();

    vi.mocked(fetch).mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.queryByText(/Can't reach the server/)).not.toBeInTheDocument();
  });

  it("also reacts to failures from ordinary page requests, not just its own health check", async () => {
    await act(async () => {
      render(<ServerOfflineBanner />);
    });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => {
      await apiRequest("/gamedays").catch(() => {});
    });
    expect(screen.getByText(/Can't reach the server/)).toBeInTheDocument();
  });
});
