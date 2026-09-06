import { useState } from "react";
import { useInstallPrompt } from "../hooks/useInstallPrompt";

const DISMISS_KEY = "vt-install-prompt-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallPwaPrompt() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const { installed, canInstall, showIOSInstructions, install, busy } = useInstallPrompt();

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* localStorage unavailable - just won't remember the dismissal */
    }
  }

  if (installed || dismissed) return null;

  if (canInstall) {
    return (
      <div className="pwa-toast">
        <span>Install this app for quicker access and notifications.</span>
        <div className="pwa-toast-actions">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={install}>
            {busy ? "..." : "Install"}
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismiss}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (showIOSInstructions) {
    return (
      <div className="pwa-toast">
        <span>
          Install this app: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </span>
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismiss}>
          ✕
        </button>
      </div>
    );
  }

  return null;
}
