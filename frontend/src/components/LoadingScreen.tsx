import { BrandMark } from "./Layout";

/** Full-screen branded loading state - the spinning mark matches the static one index.html shows before React even mounts, so the handoff is seamless. */
export function LoadingScreen() {
  return (
    <div className="app-loading">
      <div className="app-loading-mark">
        <BrandMark />
      </div>
      <span>Vienna Thirstday</span>
    </div>
  );
}
