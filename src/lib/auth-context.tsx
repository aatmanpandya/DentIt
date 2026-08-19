"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setTokens, clearTokens, getAccessToken, ApiError } from "./api-client";

export interface CurrentUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
  organization: {
    id: string;
    name: string;
    tooth_notation_display: "fdi" | "universal";
    timezone: string;
    probing_sequence: string[] | null;
  };
  location_ids: string[];
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  // Always true on both server and client's first render — reading localStorage in
  // a lazy initializer disagreed between SSR (no window, always null) and hydration
  // (real token), which threw a hydration mismatch on every hard reload of an
  // authenticated page. The token check itself has to happen in an effect, since
  // that's the earliest point server and client are guaranteed to agree.
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const token = getAccessToken();
    // No-token case still resolves through .finally() rather than an early
    // synchronous setLoading(false) — react-hooks/set-state-in-effect flags a
    // setState called directly in the effect body as a cascading-render risk.
    const check = token
      ? apiFetch<CurrentUser>("/auth/me")
          .then((me) => {
            if (!cancelled) setUser(me);
          })
          .catch(() => clearTokens())
      : Promise.resolve();
    check.finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(email: string, password: string) {
    const result = await apiFetch<{
      access_token: string;
      refresh_token: string;
      user: { id: string; full_name: string; email: string; role: string; organization_id: string };
    }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

    setTokens(result.access_token, result.refresh_token);
    const me = await apiFetch<CurrentUser>("/auth/me");
    setUser(me);
    router.push("/");
  }

  function logout() {
    clearTokens();
    setUser(null);
    router.push("/login");
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
