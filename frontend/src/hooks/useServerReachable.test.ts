import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../api/client";
import { useServerReachable } from "./useServerReachable";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useServerReachable", () => {
  it("follows the api client's reachability as requests succeed and fail", async () => {
    const { result } = renderHook(() => useServerReachable());
    expect(result.current).toBe(true);

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => {
      await apiRequest("/health").catch(() => {});
    });
    expect(result.current).toBe(false);

    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { headers: { "content-type": "application/json" } }));
    await act(async () => {
      await apiRequest("/health");
    });
    expect(result.current).toBe(true);
  });
});
