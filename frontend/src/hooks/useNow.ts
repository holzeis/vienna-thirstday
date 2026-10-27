import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs`. For render-time comparisons
 * ("has kickoff passed?") - calling Date.now() directly in render is impure,
 * and a value that never refreshes would go stale on a page left open.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
  return now;
}
