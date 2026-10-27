import { createContext } from "react";

export interface ToastMessage {
  id: number;
  text: string;
}

export interface ToastContextValue {
  showToast: (text: string, durationMs?: number) => void;
  toasts: ToastMessage[];
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);
