import type { CurrentForm } from "../api/types";

/** Small emoji badges for the transient current-form flags - shared between the full leaderboard and the Home Screen's Top 5. */
export function CurrentFormBadges({ currentForm }: { currentForm: CurrentForm }) {
  return (
    <>
      {currentForm.veteran && (
        <span className="mini-badge" title="Veteran - played all of the last 5">
          🎖️
        </span>
      )}
      {currentForm.undefeated && (
        <span className="mini-badge" title="Undefeated - unbeaten in the last 5">
          🛡️
        </span>
      )}
      {currentForm.unlucky && (
        <span className="mini-badge" title="Unlucky - lost the last 5">
          🌧️
        </span>
      )}
      {currentForm.ghost && (
        <span className="mini-badge" title="Ghost - missed the last 5">
          👻
        </span>
      )}
    </>
  );
}
