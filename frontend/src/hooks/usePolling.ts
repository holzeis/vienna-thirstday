import { useEffect, useRef } from "react";

/**
 * Re-runs `callback` on an interval so another player's changes (a new
 * registration, a posted result, ...) show up without a manual refresh.
 * Skips ticks while the tab is hidden - a backgrounded tab shouldn't keep
 * hammering the API - and refetches immediately the moment it becomes
 * visible/focused again, the same "catch up on resume" pattern already used
 * for the PWA update check.
 */
export function usePolling(callback: () => void, intervalMs: number) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    function tick() {
      if (document.visibilityState === "visible") callbackRef.current();
    }
    const interval = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);
}
