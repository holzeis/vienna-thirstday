import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./userAgent";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  ipadSafari: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
};

describe("parseUserAgent", () => {
  it("identifies iOS Safari as iOS/Safari/mobile", () => {
    expect(parseUserAgent(UA.iosSafari)).toEqual({ os: "iOS", browser: "Safari", deviceType: "mobile" });
  });

  it("identifies Chrome-on-iOS as iOS/Chrome, not Safari (CriOS still carries a Safari/ token)", () => {
    expect(parseUserAgent(UA.iosChrome)).toMatchObject({ os: "iOS", browser: "Chrome" });
  });

  it("identifies an iPad as tablet", () => {
    expect(parseUserAgent(UA.ipadSafari)).toMatchObject({ os: "iOS", deviceType: "tablet" });
  });

  it("identifies Android Chrome as Android/Chrome/mobile", () => {
    expect(parseUserAgent(UA.androidChrome)).toEqual({ os: "Android", browser: "Chrome", deviceType: "mobile" });
  });

  it("identifies Samsung Internet ahead of the Chrome token it also carries", () => {
    expect(parseUserAgent(UA.androidSamsung)).toMatchObject({ os: "Android", browser: "Samsung Internet" });
  });

  it("treats an Android device with no Mobile token as a tablet", () => {
    expect(parseUserAgent(UA.androidTablet)).toMatchObject({ os: "Android", deviceType: "tablet" });
  });

  it("identifies Windows Chrome as Windows/Chrome/desktop", () => {
    expect(parseUserAgent(UA.windowsChrome)).toEqual({ os: "Windows", browser: "Chrome", deviceType: "desktop" });
  });

  it("identifies Edge ahead of the Chrome/Safari tokens it also carries", () => {
    expect(parseUserAgent(UA.windowsEdge)).toMatchObject({ os: "Windows", browser: "Edge" });
  });

  it("identifies Windows Firefox", () => {
    expect(parseUserAgent(UA.windowsFirefox)).toEqual({ os: "Windows", browser: "Firefox", deviceType: "desktop" });
  });

  it("identifies macOS Safari as desktop", () => {
    expect(parseUserAgent(UA.macSafari)).toEqual({ os: "macOS", browser: "Safari", deviceType: "desktop" });
  });

  it("identifies Linux Firefox", () => {
    expect(parseUserAgent(UA.linuxFirefox)).toEqual({ os: "Linux", browser: "Firefox", deviceType: "desktop" });
  });

  it("falls back to Other/desktop for an empty or unrecognized string", () => {
    expect(parseUserAgent(undefined)).toEqual({ os: "Other", browser: "Other", deviceType: "desktop" });
    expect(parseUserAgent("")).toEqual({ os: "Other", browser: "Other", deviceType: "desktop" });
  });
});
