/** Shown to a waitlisted player - logged in (GamedayDetail) or a guest via the public share link (JoinGameday). */
export function WaitlistExplainer() {
  return (
    <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 8, marginBottom: 12 }}>
      Once enough players are confirmed, extra sign-ups are only confirmed in pairs so two even teams can always be
      formed - you'll move up automatically the moment a confirmed spot opens up or another pair completes.
    </p>
  );
}
