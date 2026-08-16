import type { LucideIcon } from "lucide-react";

// Same empty-state voice as the Today page — an invitation, not an apology. See
// docs/specs/validation-and-errors.md.
export function ComingSoon({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius)] border border-rule bg-surface text-ink-soft">
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <p className="text-[13px] text-ink">{title}</p>
      <p className="max-w-xs text-[12px] text-ink-soft">{body}</p>
    </div>
  );
}
