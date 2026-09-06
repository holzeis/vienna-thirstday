import { useRegisterSW } from "virtual:pwa-register/react";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly, plus a check whenever the app regains focus

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => registration.update().catch(() => {});
      setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-toast">
      <span>A new version is available.</span>
      <div className="pwa-update-actions">
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
