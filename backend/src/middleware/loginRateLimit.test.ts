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

  it("normalizes an IPv6 fallback to its /56 subnet, not the bare address", () => {
    // Same address, two different hosts within one /56 - both must key the
    // same, or an attacker can dodge the limit for free by cycling through
    // addresses in their own /64.
    const a = loginRateLimitKey({ body: {}, ip: "2001:db8:1234:5678::1" });
    const b = loginRateLimitKey({ body: {}, ip: "2001:db8:1234:5699::1" });
    expect(a).toBe(b);
    expect(a).not.toBe("2001:db8:1234:5678::1");
  });

  it("never throws on a missing body or IP", () => {
    expect(loginRateLimitKey({ body: undefined, ip: undefined })).toBe("unknown");
  });
});
