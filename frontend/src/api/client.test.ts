import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiRequest, getAuthToken, getReachable, setAuthToken, subscribeReachability } from "./client";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setAuthToken(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth token", () => {
  it("is persisted to localStorage and cleared again", () => {
    setAuthToken("abc");
    expect(getAuthToken()).toBe("abc");
    expect(localStorage.getItem("vt_token")).toBe("abc");
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem("vt_token")).toBeNull();
  });
});

describe("apiRequest", () => {
  it("sends the bearer token, app headers and a JSON body", async () => {
    setAuthToken("tok");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await apiRequest("/things", { method: "POST", body: { a: 1 } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/things");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", "X-Standalone": "0", "X-App-Version": "dev" });
  });

  it("omits Authorization when logged out and defaults to GET", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await apiRequest("/things");
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("GET");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("returns the parsed JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7 }));
    await expect(apiRequest("/things/7")).resolves.toEqual({ id: 7 });
  });

  it("returns undefined for 204 No Content", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest("/things/7", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("throws an ApiClientError carrying the server's message, status and details", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Nope", details: [{ field: "name" }] }, { status: 422 }));
    const err = await apiRequest("/things").catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 422, message: "Nope", details: [{ field: "name" }] });
  });

  it("falls back to the status text when an error response has no JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 502, statusText: "Bad Gateway" }));
    await expect(apiRequest("/things")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });
});

describe("reachability", () => {
  it("flips to unreachable when fetch itself fails, and back on any response", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReachability(listener);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(apiRequest("/things")).rejects.toMatchObject({ status: 0, message: "Could not reach the server" });
    expect(getReachable()).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);

    // An error status still proves the server answered.
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "x" }, { status: 500 }));
    await apiRequest("/things").catch(() => {});
    expect(getReachable()).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(true);

    unsubscribe();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await apiRequest("/things").catch(() => {});
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
