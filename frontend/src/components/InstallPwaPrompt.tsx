import { useEffect, useState } from "react";
import { isIOSSafari, isStandalonePwa } from "../platform";

const DISMISS_KEY = "vt-install-prompt-dismissed";

/** Chrome/Android's install prompt event - not in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallPwaPrompt() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [installed, setInstalled] = useState(isStandalonePwa);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (installed) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed]);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* localStorage unavailable - just won't remember the dismissal */
    }
  }

  async function install() {
    if (!deferredPrompt) return;
    setBusy(true);
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    } finally {
      setBusy(false);
    }
  }

  if (installed || dismissed) return null;

  if (deferredPrompt) {
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

  if (isIOSSafari()) {
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
