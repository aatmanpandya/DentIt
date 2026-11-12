"use client";

import { useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { GlobalSearch } from "./global-search";

export function TopBar() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-12 flex-none items-center gap-4 border-b border-rule bg-surface px-4 print:hidden">
      {/* The clinic's name. Not a switcher: a login belongs to exactly one clinic. */}
      <span className="px-2 py-1 text-[13px] font-medium text-ink">{user?.organization.name ?? "DentIt"}</span>

      <GlobalSearch />

      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1 text-[13px] text-ink hover:bg-steel-lo"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-steel text-[11px] font-medium text-white">
            {user?.full_name?.[0] ?? "?"}
          </span>
          <span className="max-w-[140px] truncate">{user?.full_name}</span>
          <ChevronDown size={14} className="text-ink-soft" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-[var(--radius)] border border-rule bg-surface py-1 shadow-sm">
            <div className="border-b border-rule px-3 py-2 text-[12px] text-ink-soft">
              {user?.email} · <span className="capitalize">{user?.role.replace("_", " ")}</span>
            </div>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-steel-lo"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
