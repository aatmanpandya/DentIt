"use client";

import { useState, type FormEvent } from "react";
import { useAuth, ApiError } from "@/lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="h-2 w-6 rounded-[var(--radius)] bg-band" aria-hidden />
          <span className="font-condensed text-[15px] uppercase tracking-wide text-ink">
            DentalPMS
          </span>
        </div>

        <div className="rounded-[var(--radius)] border border-rule bg-surface p-8">
          <h1 className="mb-1 text-[18px] font-medium text-ink">Sign in</h1>
          <p className="mb-6 text-ink-soft">Use the account your clinic set up for you.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-soft">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-[var(--radius)] border border-rule bg-surface px-3 py-2 text-[13px] text-ink outline-none focus-visible:border-steel"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-soft">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-[var(--radius)] border border-rule bg-surface px-3 py-2 text-[13px] text-ink outline-none focus-visible:border-steel"
              />
            </label>

            {error && (
              <p className="rounded-[var(--radius)] bg-bleed/10 px-3 py-2 text-[12px] text-bleed">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-[var(--radius)] bg-steel px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
