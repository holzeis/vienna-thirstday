// The group's actual coordination channel - last-minute updates, requests
// for extra players, weather calls, etc. live there, not in the app.
const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/9OTElaq1DMyAPNqnIMpsqx?s=cl&p=i&mlu=4&ilr=4";

/** Shown to both logged-in players (GamedayDetail) and guests (JoinGameday) - anyone involved in a matchday should be able to find the group. */
export function WhatsAppGroupLink() {
  return (
    <div className="card" style={{ marginTop: 16, textAlign: "left" }}>
      <div className="card-title">Matchday coordination</div>
      <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 0, marginBottom: 12 }}>
        Last-minute updates, requests for extra players, and anything else about the game happen in the WhatsApp group, not here.
      </p>
      <a href={WHATSAPP_GROUP_URL} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ width: "100%" }}>
        Open WhatsApp group
      </a>
    </div>
  );
}
