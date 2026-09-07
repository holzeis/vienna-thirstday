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

/** Smaller in-content spinner (same spinning mark, no text) for a table/card/page still fetching its own data - everywhere that used to show a plain "Loading..." string. */
export function Spinner() {
  return (
    <div className="loading">
      <div className="loading-mark">
        <BrandMark />
      </div>
    </div>
  );
}
