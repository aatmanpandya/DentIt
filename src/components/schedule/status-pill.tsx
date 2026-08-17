"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LEGAL_TRANSITIONS, transitionAppointment, type Appointment, type AppointmentStatus } from "@/lib/schedule-api";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  arrived: "Arrived",
  seated: "Seated",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

// Clinical status colours are reserved (bleed/caution/healthy) per docs/specs/ui-design.md
// — used here for their real semantic meaning, never decoratively.
const STATUS_COLOR_CLASS: Record<AppointmentStatus, string> = {
  scheduled: "text-ink-soft",
  confirmed: "text-steel",
  arrived: "text-caution",
  seated: "text-caution",
  completed: "text-healthy",
  cancelled: "text-ink-soft",
  no_show: "text-bleed",
};

const MENU_WIDTH = 192; // matches the menu's w-48
const MENU_HEIGHT = 180; // rough upper bound (cancel form is the tallest variant)
const VIEWPORT_PADDING = 8;

const ACTION_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirm",
  arrived: "Mark arrived",
  seated: "Mark seated",
  completed: "Mark completed",
  cancelled: "Cancel",
  no_show: "No-show",
};

export function StatusPill({ appointment, onChanged }: { appointment: Appointment; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelledBy, setCancelledBy] = useState<"patient" | "practice">("practice");
  const [busy, setBusy] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const legal = LEGAL_TRANSITIONS[appointment.status];

  // The menu is portaled to document.body rather than rendered inline: an appointment
  // block clips its own content with overflow-hidden (so a long patient name doesn't
  // spill past the block's rounded corners), and the day view's grid is itself a
  // scroll container — either ancestor would clip an absolutely-positioned dropdown
  // that needs to extend below/past the block. Positioned in viewport coordinates from
  // the trigger's own rect, so it's independent of any ancestor's overflow or scroll.
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Clamp to the viewport rather than always anchoring to the trigger's left edge —
      // a block spanning the full grid width (single-operatory focus view) puts the
      // trigger right at the screen's right edge, and a naive left-anchored menu runs
      // off-screen. Same idea vertically, in case the trigger is near the bottom.
      const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING);
      const top = rect.bottom + MENU_HEIGHT + 4 > window.innerHeight ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4;
      setMenuPos({ top, left: Math.max(left, VIEWPORT_PADDING) });
    }
    place();
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setCancelling(false);
    }
    // Closing on scroll (rather than re-tracking position) keeps this simple — the
    // day view's grid scrolls internally, and a stale-positioned menu mid-scroll would
    // be worse than just dismissing it, same as most native dropdowns do.
    function onScroll() {
      setOpen(false);
      setCancelling(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  async function choose(to: AppointmentStatus) {
    if (to === "cancelled") {
      setCancelling(true);
      return;
    }
    setBusy(true);
    try {
      await transitionAppointment(appointment.id, { to_status: to });
      onChanged();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await transitionAppointment(appointment.id, { to_status: "cancelled", reason, cancelled_by: cancelledBy });
      onChanged();
      setOpen(false);
      setCancelling(false);
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`font-condensed text-[10px] font-semibold uppercase tracking-wide ${STATUS_COLOR_CLASS[appointment.status]}`}
      >
        {STATUS_LABEL[appointment.status]}
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
            className="z-50 w-48 rounded-[var(--radius)] border border-rule bg-surface shadow-lg"
          >
            {cancelling ? (
              <div className="p-2.5">
                <label className="mb-1 block text-[11px] text-ink-soft">Reason</label>
                <input
                  autoFocus
                  className="mb-2 h-8 w-full rounded-[var(--radius)] border border-rule bg-paper px-2 text-[12px] outline-none focus-visible:border-steel"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="mb-2 flex gap-3 text-[12px] text-ink">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={cancelledBy === "practice"} onChange={() => setCancelledBy("practice")} /> Practice
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={cancelledBy === "patient"} onChange={() => setCancelledBy("patient")} /> Patient
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!reason.trim() || busy}
                  onClick={confirmCancel}
                  className="h-7 w-full rounded-[var(--radius)] bg-bleed px-2 text-[12px] font-medium text-white disabled:opacity-50"
                >
                  Confirm cancel
                </button>
              </div>
            ) : legal.length === 0 ? (
              <p className="p-2.5 text-[12px] text-ink-soft">No further changes.</p>
            ) : (
              <ul>
                {legal.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => choose(s)}
                      className="block w-full px-3 py-2 text-left text-[12px] text-ink hover:bg-steel-lo"
                    >
                      {ACTION_LABEL[s]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
