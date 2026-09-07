/** Badge color per status - shared between the matchday list and detail pages. */
export const statusClass: Record<string, string> = {
  OPEN: "badge-open",
  COMPLETED: "badge-completed",
  CANCELLED: "badge-cancelled",
  CLOSED: "badge-completed",
};

/** Kept to one 4-letter word each so the badge stays a consistent, compact width everywhere it's shown. */
export const statusLabel: Record<string, string> = {
  OPEN: "Open",
  CLOSED: "Shut",
  CANCELLED: "Nope",
  COMPLETED: "Done",
};
