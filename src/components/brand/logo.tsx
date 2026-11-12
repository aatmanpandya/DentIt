/**
 * DentIt logo, design 12A ("graduated arch, canine accent"). Eight dots read as an arch of
 * teeth: wide molars at the ends tapering to narrow incisors at the centre, with the
 * turquoise accent on both canines. The wordmark is single-weight Figtree.
 *
 * Dot geometry is shared with src/app/icon.svg (the favicon); keep the two in step.
 */

const ARCH_DOTS: ReadonlyArray<{ cx: number; cy: number; r: number; accent?: boolean }> = [
  { cx: 8.5, cy: 39.5, r: 6.5 },
  { cx: 14.5, cy: 22, r: 5.5 },
  { cx: 26.5, cy: 10.5, r: 5, accent: true },
  { cx: 41.5, cy: 5.5, r: 4.5 },
  { cx: 58.5, cy: 5.5, r: 4.5 },
  { cx: 73.5, cy: 10.5, r: 5, accent: true },
  { cx: 85.5, cy: 22, r: 5.5 },
  { cx: 91.5, cy: 39.5, r: 6.5 },
];

export const BRAND_INK = "#2a1b14";
export const BRAND_ACCENT = "#1fbfae";

/** The arch on its own. `tone="light"` is for dark backgrounds. */
export function LogoMark({ height = 16, tone = "dark" }: { height?: number; tone?: "dark" | "light" }) {
  const base = tone === "dark" ? BRAND_INK : "#ffffff";
  return (
    <svg
      viewBox="0 0 100 46"
      height={height}
      width={(height * 100) / 46}
      aria-hidden
      className="flex-none"
    >
      {ARCH_DOTS.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={d.accent ? BRAND_ACCENT : base} />
      ))}
    </svg>
  );
}

/** Mark + wordmark lockup. */
export function Logo({ height = 24 }: { height?: number }) {
  return (
    <span className="inline-flex items-center" style={{ gap: height * 0.45 }} aria-label="DentIt">
      <LogoMark height={height * 1.15} />
      <span
        className="font-brand font-bold leading-none"
        style={{ fontSize: height * 1.25, color: BRAND_INK, letterSpacing: "-0.02em" }}
        aria-hidden
      >
        DentIT
      </span>
    </span>
  );
}
