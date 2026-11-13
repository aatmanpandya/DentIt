"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { NavRail } from "@/components/shell/nav-rail";
import { TopBar } from "@/components/shell/top-bar";
import { ToastProvider } from "@/components/ui/toast";
import { QueryErrorToasts } from "@/components/ui/query-error-toasts";
import { LogoMark } from "@/components/brand/logo";

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper" role="status" aria-label="Loading">
        <span className="animate-pulse">
          <LogoMark height={28} />
        </span>
      </div>
    );
  }

  if (!user) return null;

  return (
    <ToastProvider>
      <QueryErrorToasts />
      {/* print: the fixed-height scroll shell would clip a long invoice to one page. */}
      <div className="flex h-screen flex-col bg-paper print:block print:h-auto">
        <TopBar />
        <div className="flex min-h-0 flex-1 print:block">
          <NavRail />
          <main className="min-w-0 flex-1 overflow-auto print:overflow-visible">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
