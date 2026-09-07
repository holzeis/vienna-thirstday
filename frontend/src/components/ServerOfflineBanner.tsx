import { useEffect } from "react";
import { getHealth } from "../api/endpoints";
import { usePolling } from "../hooks/usePolling";
import { useServerReachable } from "../hooks/useServerReachable";

const HEALTH_CHECK_INTERVAL_MS = 20000;

/**
 * Reflects actual backend reachability (see api/client.ts's reachability
 * tracking), not navigator.onLine - the device can have a fine network
 * connection while our server is down. Most pages already keep this fresh
 * just by making their normal requests; this adds a lightweight periodic
 * health check so the banner also appears/clears on pages that otherwise
 * wouldn't call the API for a while.
 */
export function ServerOfflineBanner() {
  const reachable = useServerReachable();

  function check() {
    getHealth().catch(() => {
      /* failure already recorded by apiRequest's reachability tracking */
    });
  }

  useEffect(check, []);
  usePolling(check, HEALTH_CHECK_INTERVAL_MS);

  if (reachable) return null;

  return (
    <div className="pwa-toast pwa-toast-error">
      <span>Can't reach the server - retrying...</span>
    </div>
  );
}
