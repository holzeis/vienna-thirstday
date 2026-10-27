import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("calls back on every interval while the tab is visible", () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 1000));
    vi.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("skips ticks while the tab is hidden", () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 1000));
    setVisibility("hidden");
    vi.advanceTimersByTime(3000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("catches up immediately when the tab becomes visible or focused again", () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 60_000));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without restarting the timer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 1000), { initialProps: { cb: first } });
    rerender({ cb: second });
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops polling on unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => usePolling(cb, 1000));
    unmount();
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("focus"));
    expect(cb).not.toHaveBeenCalled();
  });
});
