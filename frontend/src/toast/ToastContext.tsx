import { useCallback, useState, type ReactNode } from "react";
import { ToastContext, type ToastMessage } from "./context";
import { useToast } from "./useToast";

let nextId = 1;
const DEFAULT_DURATION_MS = 2500;

/**
 * Simple auto-dismissing toast messages (e.g. "Link copied"). Doesn't
 * render its own fixed container - see ToastHost, rendered inside the same
 * .pwa-toast-stack the PWA update/install prompts already use (App.tsx),
 * so everything stacks instead of overlapping.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((text: string, durationMs = DEFAULT_DURATION_MS) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((toast) => toast.id !== id));
    }, durationMs);
  }, []);

  return <ToastContext.Provider value={{ showToast, toasts }}>{children}</ToastContext.Provider>;
}

/** Renders the active toasts - drop this inside the shared .pwa-toast-stack container. */
export function ToastHost() {
  const { toasts } = useToast();
  return (
    <>
      {toasts.map((t) => (
        <div className="pwa-toast" key={t.id}>
          <span>{t.text}</span>
        </div>
      ))}
    </>
  );
}
