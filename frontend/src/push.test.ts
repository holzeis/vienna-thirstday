import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "./api/endpoints";
import * as platform from "./platform";
import { disablePushNotifications, enablePushNotifications, getExistingPushSubscription, isPushSupported } from "./push";

vi.mock("./api/endpoints");
vi.mock("./platform");

const subscription = { endpoint: "https://push.example/abc", unsubscribe: vi.fn(), toJSON: () => ({ endpoint: "https://push.example/abc" }) };
const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() };

/** jsdom has none of the Push API, so each test installs just what it needs. */
function installPushApi() {
  Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve({ pushManager }) }, configurable: true });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
}

beforeEach(() => {
  vi.resetAllMocks();
  subscription.unsubscribe.mockResolvedValue(true);
  vi.mocked(platform.isIOS).mockReturnValue(false);
  vi.mocked(platform.isStandalonePwa).mockReturnValue(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe("isPushSupported", () => {
  it("is false without the Push API", () => {
    expect(isPushSupported()).toBe(false);
  });

  it("is true wherever the API exists - except iOS outside the installed app, where subscribing always rejects", () => {
    installPushApi();
    expect(isPushSupported()).toBe(true);
    vi.mocked(platform.isIOS).mockReturnValue(true);
    expect(isPushSupported()).toBe(false);
    vi.mocked(platform.isStandalonePwa).mockReturnValue(true);
    expect(isPushSupported()).toBe(true);
  });
});

describe("getExistingPushSubscription", () => {
  it("is null when unsupported, without touching the service worker", async () => {
    await expect(getExistingPushSubscription()).resolves.toBeNull();
  });

  it("returns the browser's current subscription", async () => {
    installPushApi();
    pushManager.getSubscription.mockResolvedValue(subscription);
    await expect(getExistingPushSubscription()).resolves.toBe(subscription);
  });
});

describe("enablePushNotifications", () => {
  it("refuses when unsupported", async () => {
    await expect(enablePushNotifications()).rejects.toThrow("aren't supported");
  });

  it("refuses when the user does not grant permission, before asking the server for anything", async () => {
    installPushApi();
    vi.mocked(Notification.requestPermission).mockResolvedValue("denied");
    await expect(enablePushNotifications()).rejects.toThrow("permission was not granted");
    expect(endpoints.getVapidPublicKey).not.toHaveBeenCalled();
  });

  it("subscribes with the server's VAPID key (decoded from URL-safe base64) and registers the subscription", async () => {
    installPushApi();
    vi.mocked(endpoints.getVapidPublicKey).mockResolvedValue({ publicKey: "AQID-_8" }); // bytes 1,2,3,251,255
    pushManager.subscribe.mockResolvedValue(subscription);
    vi.mocked(endpoints.subscribeToPush).mockResolvedValue({ ok: true });

    await enablePushNotifications();

    const options = pushManager.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual([1, 2, 3, 251, 255]);
    expect(endpoints.subscribeToPush).toHaveBeenCalledWith({ endpoint: "https://push.example/abc" });
  });
});

describe("disablePushNotifications", () => {
  it("does nothing when there is no subscription", async () => {
    installPushApi();
    pushManager.getSubscription.mockResolvedValue(null);
    await disablePushNotifications();
    expect(endpoints.unsubscribeFromPush).not.toHaveBeenCalled();
  });

  it("unsubscribes in the browser and tells the server", async () => {
    installPushApi();
    pushManager.getSubscription.mockResolvedValue(subscription);
    vi.mocked(endpoints.unsubscribeFromPush).mockResolvedValue({ ok: true });
    await disablePushNotifications();
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(endpoints.unsubscribeFromPush).toHaveBeenCalledWith("https://push.example/abc");
  });
});
