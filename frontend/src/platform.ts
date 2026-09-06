/** True once launched from a home-screen icon (Android/desktop `display-mode`, or iOS Safari's non-standard `navigator.standalone`). */
export function isStandalonePwa(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** iOS's in-app browsers (Chrome/Firefox-on-iOS) can't install to the home screen - only Safari itself can. */
export function isIOSSafari(): boolean {
  return isIOS() && /^((?!crios|fxios|chrome|android).)*safari/i.test(navigator.userAgent);
}
