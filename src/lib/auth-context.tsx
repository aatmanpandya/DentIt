"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setTokens, clearTokens, getAccessToken, ApiError } from "./api-client";

export interface CurrentUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
  organization: { id: string; name: string; tooth_notation_display: "fdi" | "universal" };
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
  // Lazy initializer, not an effect — avoids setState-in-effect entirely for the
  // no-token case, and keeps the token check synchronous with first paint.
  const [loading, setLoading] = useState(() => Boolean(getAccessToken()));
  const router = useRouter();

  useEffect(() => {
    if (!getAccessToken()) return;
    let cancelled = false;
    apiFetch<CurrentUser>("/auth/me")
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => clearTokens())
      .finally(() => {
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
