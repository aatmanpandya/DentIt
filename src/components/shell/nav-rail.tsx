"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, CalendarDays, Users, ClipboardList, Receipt, Settings } from "lucide-react";
import clsx from "clsx";

/**
 * Icon-only left rail — width is worth more than affordance here, and staff learn
 * six icons in a day. See docs/specs/ui-design.md.
 */
const ITEMS = [
  { href: "/", label: "Today", icon: LayoutGrid },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/plans", label: "Treatment plans", icon: ClipboardList },
  { href: "/ledger", label: "Ledger", icon: Receipt },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavRail() {
  const pathname = usePathname();

  return (
    <nav className="flex w-14 flex-none flex-col items-center gap-1 border-r border-rule bg-surface py-3 print:hidden">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "group relative flex h-10 w-10 items-center justify-center rounded-[var(--radius)] transition-colors",
              active ? "bg-steel-lo text-steel" : "text-ink-soft hover:bg-steel-lo hover:text-steel",
            )}
          >
            <Icon size={18} strokeWidth={1.75} />
            {active && (
              // Flush with the button's own left edge, not offset further left — a
              // negative offset here pushes past the rail's true left edge (x=0) and
              // renders off-canvas, invisible. See docs/specs/ui-design.md.
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-steel" aria-hidden />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
