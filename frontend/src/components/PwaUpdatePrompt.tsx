import { useRegisterSW } from "virtual:pwa-register/react";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly, plus a check whenever the app regains focus

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // A worker already sitting in `waiting` at a fresh page load means an
      // update went unapplied last session (toast missed/dismissed, or the
      // app was never foregrounded long enough to show it - common on iOS
      // Home Screen apps, which can go long stretches without running any
      // JS at all). Nothing is in progress yet at this point, so it's safe
      // to apply immediately rather than risk leaving the install stuck on
      // a stale build indefinitely.
      if (registration.waiting) {
        updateServiceWorker(true);
        return;
      }
      const check = () => registration.update().catch(() => {});
      setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="pwa-toast">
      <span>A new version is available.</span>
      <div className="pwa-toast-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => updateServiceWorker(true)}>
          Update
        </button>
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNeedRefresh(false)}>
          ✕
        </button>
      </div>
    </div>
  );
}
