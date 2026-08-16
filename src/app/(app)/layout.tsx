"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { NavRail } from "@/components/shell/nav-rail";
import { TopBar } from "@/components/shell/top-bar";

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-paper text-ink-soft">Loading…</div>;
  }

  if (!user) return null;

  return (
    <div className="flex h-screen flex-col bg-paper">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
