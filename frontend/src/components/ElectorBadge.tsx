/** Marks the matchday's two electors - the best-ranked confirmed players, who pick the teams. Deliberately muted so it reads as a hint, not a badge to chase. */
export function ElectorBadge({ rank }: { rank: 1 | 2 | null }) {
  if (!rank) return null;
  return (
    <span className="mini-badge" style={{ opacity: 0.6 }} title={rank === 1 ? "Elector - picks first" : "Elector - picks second"}>
      🗳️
    </span>
  );
}
