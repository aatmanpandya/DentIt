"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The one undo-toast primitive for the whole app — ui-design.md's "no confirmation
 * dialogs for reversible actions, undo toast instead" is a codebase-wide interaction
 * rule, not odontogram-specific, and nothing implemented it before now. Deliberately
 * small: one toast at a time, auto-dismiss, one optional undo action. No queueing —
 * a second showToast() call simply replaces whatever's showing.
 */

interface ShowToastInput {
  message: string;
  onUndo?: () => void;
  /** A forward action instead of (or as well as) undo — e.g. "Create invoice" after completing work. */
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  showToast: (input: ShowToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ShowToastInput & { id: number }) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const showToast = useCallback((input: ShowToastInput) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = ++nextId.current;
    setToast({ ...input, id });
    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius)] border border-rule bg-surface px-3 py-2 text-[13px] text-ink shadow-lg transition-opacity duration-[120ms] ease-out"
        >
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              onClick={() => {
                toast.onUndo?.();
                dismiss();
              }}
              className="font-medium text-steel hover:underline"
            >
              Undo
            </button>
          )}
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.onClick();
                dismiss();
              }}
              className="font-medium text-steel hover:underline"
            >
              {toast.action.label}
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss" className="text-ink-soft hover:text-ink">
            <X size={13} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
