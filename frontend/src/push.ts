import { getVapidPublicKey, subscribeToPush, unsubscribeFromPush } from "./api/endpoints";
import { isIOS, isStandalonePwa } from "./platform";

/**
 * iOS Safari exposes the Push API even in a regular browser tab, but
 * subscribing there always rejects - WebKit only allows it once the site is
 * installed to the home screen. Other platforms (Android/desktop) support
 * push in a regular tab just fine.
 */
export function isPushSupported(): boolean {
  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!hasApi) return false;
  return isIOS() ? isStandalonePwa() : true;
}

/** VAPID applicationServerKey must be a Uint8Array, but the server hands it over as URL-safe base64. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePushNotifications(): Promise<void> {
  if (!isPushSupported()) throw new Error("Push notifications aren't supported on this browser/device.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const { publicKey } = await getVapidPublicKey();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  await subscribeToPush(subscription.toJSON() as PushSubscriptionJSON);
}

export async function disablePushNotifications(): Promise<void> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await unsubscribeFromPush(endpoint);
}
