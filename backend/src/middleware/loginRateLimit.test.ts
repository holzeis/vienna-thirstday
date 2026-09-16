import { describe, expect, it } from "vitest";
import { loginRateLimitKey } from "./loginRateLimit";

describe("loginRateLimitKey", () => {
  it("keys by the submitted name, case-insensitively", () => {
    expect(loginRateLimitKey({ body: { name: "Admin" }, ip: "1.2.3.4" })).toBe("admin");
    expect(loginRateLimitKey({ body: { name: "  ADMIN  " }, ip: "1.2.3.4" })).toBe("admin");
  });

  it("falls back to the request IP when no name was submitted", () => {
    expect(loginRateLimitKey({ body: {}, ip: "1.2.3.4" })).toBe("1.2.3.4");
  });

  it("never throws on a missing body or IP", () => {
    expect(loginRateLimitKey({ body: undefined, ip: undefined })).toBe("unknown");
  });
});
