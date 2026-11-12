import clsx from "clsx";

/**
 * Placeholder block while data loads — keeps the page's shape instead of flashing
 * "Loading…" text and then jumping. Decorative only (aria-hidden).
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("block animate-pulse rounded-[var(--radius)] bg-steel-lo", className)} />;
}
