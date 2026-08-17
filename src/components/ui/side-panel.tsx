"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The app's first side-panel primitive — "side panels, not modals, wherever context
 * matters" per docs/specs/ui-design.md. Anchored right, doesn't cover the screen (the
 * day view stays visible and the rest of the UI stays interactive), Esc closes, no
 * confirm-to-close since the panel itself is the confirmable action.
 */
export function SidePanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label={title}
      className="fixed right-0 top-0 z-20 flex h-full w-[420px] flex-col border-l border-rule bg-surface shadow-lg outline-none"
    >
      <div className="flex flex-none items-center justify-between border-b border-rule px-4 py-3">
        <h2 className="font-condensed text-[13px] font-semibold text-ink">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}
