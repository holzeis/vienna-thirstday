import { describe, expect, it } from "vitest";
import { statusClass, statusLabel } from "./gamedayStatus";

describe("gameday status maps", () => {
  it("has a badge class and a label for every status", () => {
    const statuses = ["OPEN", "CLOSED", "CANCELLED", "COMPLETED"];
    for (const s of statuses) {
      expect(statusClass[s]).toBeTruthy();
      expect(statusLabel[s]).toBeTruthy();
    }
  });
  it("keeps every label to 4 letters so the badge stays a consistent width", () => {
    for (const label of Object.values(statusLabel)) expect(label).toHaveLength(4);
  });
});
