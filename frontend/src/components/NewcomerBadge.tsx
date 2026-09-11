/** Badge marking a player's first-ever season - shared between the leaderboard, the Home Screen's Top 5, and a matchday's Confirmed/Waitlist lists. */
export function NewcomerBadge({ isNewcomer }: { isNewcomer: boolean }) {
  if (!isNewcomer) return null;
  return (
    <span className="mini-badge" title="Newcomer - first season in the squad">
      🌱
    </span>
  );
}
