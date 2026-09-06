import { useEffect, useState } from "react";
import { isIOSSafari, isStandalonePwa } from "../platform";

/** Chrome/Android's install prompt event - not in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Shared install-prompt state, used both by the app-wide dismissible toast
 * (components/InstallPwaPrompt.tsx) and by contextual inline prompts (e.g.
 * JoinGameday's post-signup confirmation) - one listener for
 * beforeinstallprompt/appinstalled regardless of how many places render it.
 */
export function useInstallPrompt() {
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

  return {
    installed,
    canInstall: !!deferredPrompt,
    showIOSInstructions: !installed && !deferredPrompt && isIOSSafari(),
    install,
    busy,
  };
}
