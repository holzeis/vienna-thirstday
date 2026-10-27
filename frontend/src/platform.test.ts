import { afterEach, describe, expect, it, vi } from "vitest";
import { isIOS, isIOSSafari, isStandalonePwa } from "./platform";

function setUserAgent(ua: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { standalone?: boolean }).standalone;
});

describe("isIOS / isIOSSafari", () => {
  const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";

  it("recognises iPhone/iPad/iPod user agents", () => {
    setUserAgent(SAFARI);
    expect(isIOS()).toBe(true);
    setUserAgent(ANDROID);
    expect(isIOS()).toBe(false);
  });

  it("only treats Safari itself as iOS Safari - not Chrome or Firefox on iOS, which can't install to the home screen", () => {
    setUserAgent(SAFARI);
    expect(isIOSSafari()).toBe(true);
    setUserAgent(CHROME_IOS);
    expect(isIOSSafari()).toBe(false);
    setUserAgent(ANDROID);
    expect(isIOSSafari()).toBe(false);
  });
});

describe("isStandalonePwa", () => {
  it("is false in a regular browser tab", () => {
    expect(isStandalonePwa()).toBe(false);
  });

  it("is true when the display-mode media query matches", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(isStandalonePwa()).toBe(true);
  });

  it("is true for iOS Safari's non-standard navigator.standalone", () => {
    (navigator as { standalone?: boolean }).standalone = true;
    expect(isStandalonePwa()).toBe(true);
  });
});
