import { useEffect, useState } from "react";
import { enablePushNotifications, getExistingPushSubscription, isPushSupported } from "../push";
import { isStandalonePwa } from "../platform";
import { useToast } from "../toast/ToastContext";
import { useAuth } from "../auth/AuthContext";

const DISMISS_KEY = "vt-push-prompt-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* localStorage unavailable - just won't remember the dismissal */
  }
}

/**
 * Nudges PWA-installed users who haven't enabled push into doing so - about
 * half of installs never turn it on, and the only other entry point is the
 * toggle buried in the profile page (PlayerProfile.tsx), which nobody visits
 * unprompted. Only shown once per browser, and only to a logged-in user
 * (subscribing requires an authenticated /push/subscribe call): dismissed
 * or enabled both retire it via DISMISS_KEY, and a denied OS permission is
 * never re-offered since requestPermission() can't re-prompt for it.
 */
export function PushNotificationPrompt() {
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (!user || dismissed || !isStandalonePwa() || !isPushSupported() || Notification.permission === "denied") {
      return;
    }
    getExistingPushSubscription().then((sub) => setEligible(!sub));
  }, [user, dismissed]);

  function dismiss() {
    setDismissed(true);
    rememberDismissed();
  }

  async function enable() {
    setError(null);
    setBusy(true);
    try {
      await enablePushNotifications();
      rememberDismissed();
      setDismissed(true);
      showToast("Push notifications enabled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!eligible || dismissed) return null;

  return (
    <div className="pwa-toast">
      <span>
        Turn on push notifications to hear about new matchdays right away. You can disable them anytime in your
        profile.
        {error && (
          <>
            <br />
            <span style={{ color: "var(--alert-error-text)" }}>{error}</span>
          </>
        )}
      </span>
      <div className="pwa-toast-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={enable}>
          {busy ? "..." : "Enable"}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={dismiss}>
          Cancel
        </button>
      </div>
    </div>
  );
}
