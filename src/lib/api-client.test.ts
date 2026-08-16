// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Bug: apiFetch never used the refresh token at all. auth-context.tsx's initial
 * /auth/me call just cleared tokens on ANY failure, including a routine expired
 * access token — so every user was force-logged-out every 15 minutes regardless of
 * activity, and the entire refresh-token/rotation design (docs/specs/pilot-foundations.md
 * §7: 30-min idle timeout, 7-day refresh lifetime) was unreachable dead code.
 *
 * Expected behavior under test: on a 401 with an existing refresh token, apiFetch
 * transparently refreshes and retries the original request once before giving up.
 */

async function freshApiClient() {
  vi.resetModules();
  return import("./api-client");
}

describe("apiFetch auto-refresh on expired access token", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("transparently refreshes and retries once when the access token has expired", async () => {
    const { apiFetch, setTokens, getAccessToken } = await freshApiClient();
    setTokens("stale-access-token", "valid-refresh-token");

    const fetchMock = vi.fn();
    // 1st call: the real request, rejected as expired.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "AUTH_TOKEN_EXPIRED", message: "expired" } }), { status: 401 }),
    );
    // 2nd call: POST /auth/refresh succeeds with a new token pair.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "new-access-token", refresh_token: "new-refresh-token" }), {
        status: 200,
      }),
    );
    // 3rd call: the retried original request, now successful.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/patients");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/auth/refresh");
    // The retried request must carry the NEW access token, not the stale one.
    const retriedHeaders = fetchMock.mock.calls[2][1]?.headers as Record<string, string>;
    expect(retriedHeaders.Authorization).toBe("Bearer new-access-token");
    // Tokens in storage must be updated for subsequent calls.
    expect(getAccessToken()).toBe("new-access-token");
  });

  it("clears tokens and throws the original error when the refresh token itself is invalid", async () => {
    const { apiFetch, setTokens, getAccessToken, ApiError } = await freshApiClient();
    setTokens("stale-access-token", "expired-refresh-token");

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "AUTH_TOKEN_EXPIRED", message: "expired" } }), { status: 401 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "AUTH_TOKEN_EXPIRED", message: "refresh expired too" } }), {
        status: 401,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/patients")).rejects.toThrow(ApiError);
    // Exactly the original request + the failed refresh attempt — never an infinite loop.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
  });

  it("does not attempt a refresh when there is no refresh token to use", async () => {
    const { apiFetch } = await freshApiClient();
    // No setTokens() call — an unauthenticated request.

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "AUTH_TOKEN_EXPIRED", message: "no session" } }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/patients")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
