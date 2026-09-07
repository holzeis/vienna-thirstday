import { useEffect, useRef, useState } from "react";
import { isStandalonePwa } from "../platform";
import { BrandMark } from "./Layout";

const THRESHOLD_PX = 70;
const MAX_PULL_PX = 100;
const RESISTANCE = 0.5;

/**
 * Pull-to-refresh, PWA-only. Regular mobile browser tabs keep their own
 * native pull-to-refresh (and a visible reload button/address bar besides),
 * but the mobile layout disables the browser's rubber-banding entirely
 * (`body { overscroll-behavior-y: none }` in app.css, added to stop it
 * fighting the fixed topbar/tabbar) - which also silently killed the
 * browser's native pull-to-refresh there too. An installed PWA has no
 * browser chrome at all, so that's the one context that actually needs a
 * replacement gesture; this deliberately reloads the whole document
 * (matching what pull-to-refresh does everywhere else) rather than just
 * refetching data.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!isStandalonePwa()) return;

    function reset() {
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
    }

    function onTouchStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1 || window.scrollY > 0) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        reset();
        return;
      }
      e.preventDefault();
      pullRef.current = Math.min(delta * RESISTANCE, MAX_PULL_PX);
      setPull(pullRef.current);
    }

    function onTouchEnd() {
      if (startY.current === null) return;
      const pulledFarEnough = pullRef.current >= THRESHOLD_PX;
      reset();
      if (pulledFarEnough) {
        setRefreshing(true);
        window.location.reload();
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing]);

  if (pull === 0 && !refreshing) return null;

  const progress = Math.min(pull / THRESHOLD_PX, 1);

  return (
    <div className="pull-refresh" style={{ transform: `translate(-50%, ${(refreshing ? THRESHOLD_PX : pull) - 40}px)` }}>
      <div
        className={refreshing ? "pull-refresh-mark pull-refresh-mark-spinning" : "pull-refresh-mark"}
        style={refreshing ? undefined : { transform: `rotate(${progress * 360}deg)`, opacity: progress }}
      >
        <BrandMark />
      </div>
    </div>
  );
}
