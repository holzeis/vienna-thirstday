import { isStandalonePwa } from "../platform";

export const API_BASE = import.meta.env.VITE_API_URL || "/api";

export class ApiClientError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let authToken: string | null = localStorage.getItem("vt_token");

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem("vt_token", token);
  } else {
    localStorage.removeItem("vt_token");
  }
}

export function getAuthToken() {
  return authToken;
}

// Tracks whether the backend actually responded to the last request - not
// navigator.onLine, which only reflects the device's network interface and
// says nothing about whether our server is reachable. Every apiRequest call
// updates this; subscribe via subscribeReachability to react to changes.
type ReachabilityListener = (reachable: boolean) => void;
let reachable = true;
const reachabilityListeners = new Set<ReachabilityListener>();

function setReachable(next: boolean) {
  if (reachable === next) return;
  reachable = next;
  reachabilityListeners.forEach((listener) => listener(reachable));
}

export function getReachable(): boolean {
  return reachable;
}

export function subscribeReachability(listener: ReachabilityListener): () => void {
  reachabilityListeners.add(listener);
  return () => reachabilityListeners.delete(listener);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Only the client can know this (display-mode isn't visible in the User-
  // Agent) - the backend reads it for the access-metrics table (see
  // services/accessEventService.ts). Harmless on requests that don't record
  // anything; costs nothing to always send.
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Standalone": isStandalonePwa() ? "1" : "0" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // A thrown fetch means the request never got a response at all (offline,
    // DNS failure, connection refused, timeout) - as opposed to the server
    // responding with an error status, which still means it's reachable.
    setReachable(false);
    throw new ApiClientError(0, "Could not reach the server");
  }
  setReachable(true);

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : undefined;

  if (!res.ok) {
    const message = (data && (data as any).error) || res.statusText || "Request failed";
    throw new ApiClientError(res.status, message, data && (data as any).details);
  }

  return data as T;
}
