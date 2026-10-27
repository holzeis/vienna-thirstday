import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("starts at the current time and advances on each interval", () => {
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(Date.parse("2026-10-27T12:00:00Z"));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(Date.parse("2026-10-27T12:00:03Z"));
  });
});
