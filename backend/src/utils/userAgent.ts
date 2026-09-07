/**
 * Small, dependency-free User-Agent classifier for the access-metrics table
 * (see db/schema.ts's accessEvents) - not meant to be exhaustive, just good
 * enough for "which OS/browser/device" breakdowns in a dashboard. The raw
 * string is always stored alongside the parsed fields, so a misclassified
 * row can still be re-examined or re-parsed later.
 *
 * One known, unavoidable gap: iPadOS 13+ Safari's default UA is
 * indistinguishable from desktop macOS Safari server-side (no "iPad" token)
 * - a well-documented platform limitation, not something worth working
 * around with a heavier client-side detection scheme for a metrics table.
 */
export interface ParsedUserAgent {
  os: string;
  browser: string;
  deviceType: "mobile" | "tablet" | "desktop";
}

export function parseUserAgent(userAgent: string | undefined | null): ParsedUserAgent {
  const ua = userAgent ?? "";

  const os = (() => {
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Android/i.test(ua)) return "Android";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
    if (/CrOS/i.test(ua)) return "ChromeOS";
    if (/Linux/i.test(ua)) return "Linux";
    return "Other";
  })();

  // Order matters: Chrome/Edge/Samsung Internet all include "Safari/x.y" in
  // their UA for compatibility, so the more specific tokens are checked first.
  const browser = (() => {
    if (/Edg\//i.test(ua)) return "Edge";
    if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
    if (/Firefox\//i.test(ua)) return "Firefox";
    if (/CriOS/i.test(ua)) return "Chrome"; // Chrome on iOS
    if (/FxiOS/i.test(ua)) return "Firefox"; // Firefox on iOS
    if (/Chrome\//i.test(ua)) return "Chrome";
    if (/Safari\//i.test(ua)) return "Safari";
    return "Other";
  })();

  const deviceType = (() => {
    if (/iPad/i.test(ua)) return "tablet" as const;
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet" as const;
    if (/Mobi|iPhone|iPod/i.test(ua)) return "mobile" as const;
    if (/Android/i.test(ua)) return "mobile" as const;
    return "desktop" as const;
  })();

  return { os, browser, deviceType };
}
