"use client";

/**
 * Thin fetch wrapper. Every call goes to /api/v1, attaches the bearer token, and
 * unwraps the { error: { code, message } } shape from docs/specs/validation-and-errors.md
 * into a typed ApiError the UI can switch on.
 */

const TOKEN_KEY = "dentalpms_access_token";
const REFRESH_KEY = "dentalpms_refresh_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

async function rawFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  return fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const err = body?.error ?? { code: "INTERNAL_ERROR", message: "Something went wrong. Try again." };
  return new ApiError(res.status, err.code, err.message, err.details);
}

/**
 * On a 401 (access token expired — normal after 15 min, per docs/specs/pilot-foundations.md
 * §7) with a refresh token on hand, silently refresh and retry the request once before
 * giving up. Without this, every user was force-logged-out every 15 minutes regardless
 * of activity, and the refresh token was never actually used for anything.
 */
async function refreshAndRetry<T>(path: string, init: RequestInit): Promise<T> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearTokens();
    throw new ApiError(401, "AUTH_TOKEN_EXPIRED", "Sign in to continue.");
  }

  const refreshRes = await rawFetch("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }, null);
  if (!refreshRes.ok) {
    clearTokens();
    throw await toApiError(refreshRes);
  }

  const { access_token, refresh_token } = await refreshRes.json();
  setTokens(access_token, refresh_token);

  const retryRes = await rawFetch(path, init, access_token);
  if (!retryRes.ok) throw await toApiError(retryRes);
  if (retryRes.status === 204) return undefined as T;
  return retryRes.json();
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await rawFetch(path, init, getAccessToken());

  if (res.status === 401) return refreshAndRetry<T>(path, init);

  if (!res.ok) throw await toApiError(res);

  if (res.status === 204) return undefined as T;
  return res.json();
}
