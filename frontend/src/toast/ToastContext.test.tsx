import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost, ToastProvider } from "./ToastContext";
import { useToast } from "./useToast";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>
    {children}
    <ToastHost />
  </ToastProvider>
);

describe("toasts", () => {
  it("shows a toast and dismisses it after the default 2.5s", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast("Link copied"));
    expect(screen.getByText("Link copied")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(screen.getByText("Link copied")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
  });

  it("honours a custom duration and keeps overlapping toasts independent", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.showToast("short", 1000);
      result.current.showToast("long", 5000);
    });
    expect(screen.getByText("short")).toBeInTheDocument();
    expect(screen.getByText("long")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("short")).not.toBeInTheDocument();
    expect(screen.getByText("long")).toBeInTheDocument();
  });

  it("throws a helpful error when used outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<HookUser />)).toThrow("useToast must be used within ToastProvider");
  });
});

function HookUser() {
  useToast();
  return null;
}
