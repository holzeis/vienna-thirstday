import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInstallPrompt } from "./useInstallPrompt";

function fireInstallPrompt(userChoice: Promise<{ outcome: "accepted" | "dismissed" }> = Promise.resolve({ outcome: "accepted" })) {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useInstallPrompt", () => {
  it("starts out not installable", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current).toMatchObject({ installed: false, canInstall: false, busy: false });
  });

  it("captures beforeinstallprompt (suppressing the browser's own mini-infobar) and offers to install", () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = fireInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.canInstall).toBe(true);
  });

  it("shows the native prompt on install() and then forgets it", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = fireInstallPrompt();
    await act(async () => {
      await result.current.install();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it("does nothing on install() when no prompt was captured", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {
      await result.current.install();
    });
    expect(result.current.busy).toBe(false);
  });

  it("flips to installed on appinstalled", () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireInstallPrompt();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current).toMatchObject({ installed: true, canInstall: false });
  });

  it("reports installed from the start when already running as a PWA", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.installed).toBe(true);
  });
});
