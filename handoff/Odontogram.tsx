'use client';
/**
 * Odontogram.tsx — clickable dental chart built on ./odontogram-teeth.
 *
 * Controlled or uncontrolled. State is a plain object keyed by FDI number:
 *   { 16: { whole: 'crown', surfaces: { O: 'caries', M: 'filling' } } }
 * which serialises straight to an API.
 *
 *   const [chart, setChart] = useState<Chart>({});
 *   const [condition, setCondition] = useState('caries');
 *   <Odontogram value={chart} onChange={setChart}
 *               condition={condition} onConditionChange={setCondition} />
 *
 * Styling is inline with a `theme` prop so the component carries no CSS dependency.
 * Swap the style objects for your own classNames if you prefer Tailwind.
 */
import React, { useMemo, useState, useCallback } from 'react';
import {
  toothGeometry, surfaceWedges, isAnterior, SURFACE_NAMES,
  FDI_UPPER, FDI_LOWER, FDI_UPPER_PRIMARY, FDI_LOWER_PRIMARY,
  type SurfaceCode, type ToothGeometry
} from './odontogram-teeth';

export type ConditionKey = string;

export interface ToothChartEntry {
  whole?: ConditionKey | null;
  surfaces?: Partial<Record<SurfaceCode, ConditionKey>>;
}
export type Chart = Record<string, ToothChartEntry>;

export interface Condition {
  key: ConditionKey;
  label: string;
  color: string;        // marker colour, used on surfaces and the FDI number
  toothFill?: string;   // whole-tooth wash; omit to keep the default enamel fill
  ghost?: boolean;      // fade the silhouette and cross it out (missing / extracted)
}

export const CONDITIONS: Condition[] = [
  { key: 'caries', label: 'Caries', color: '#B25436', toothFill: '#E2B8A6' },
  { key: 'filling', label: 'Filling', color: '#26221D', toothFill: '#BDB6AC' },
  { key: 'crown', label: 'Crown', color: '#8A7A46', toothFill: '#D9CE9F' },
  { key: 'implant', label: 'Implant', color: '#4E6FA4', toothFill: '#C3D0E4' },
  { key: 'missing', label: 'Missing', color: '#9A9086', ghost: true }
];

export interface Theme {
  ink: string; paper: string; surface: string; enamel: string; accent: string; mono: string;
}
export const DEFAULT_THEME: Theme = {
  ink: '#26221D',
  paper: '#FCFAF5',
  surface: '#FCFAF5',
  enamel: '#F3ECDD',
  accent: '#B25436',
  mono: "'IBM Plex Mono', ui-monospace, monospace"
};

export interface OdontogramProps {
  value?: Chart;
  defaultValue?: Chart;
  onChange?: (next: Chart) => void;
  /** Active condition applied by a click. Uncontrolled if you omit both. */
  condition?: ConditionKey;
  onConditionChange?: (key: ConditionKey) => void;
  conditions?: Condition[];
  dentition?: 'permanent' | 'primary' | 'mixed';
  readOnly?: boolean;
  showToolbar?: boolean;
  onSelectTooth?: (fdi: number, geometry: ToothGeometry) => void;
  theme?: Partial<Theme>;
}

export function Odontogram({
  value, defaultValue, onChange,
  condition, onConditionChange,
  conditions = CONDITIONS,
  dentition = 'permanent',
  readOnly = false,
  showToolbar = true,
  onSelectTooth,
  theme: themeIn
}: OdontogramProps) {
  const theme = { ...DEFAULT_THEME, ...themeIn };
  const [internal, setInternal] = useState<Chart>(defaultValue ?? {});
  const chart = value ?? internal;
  const [internalCond, setInternalCond] = useState<ConditionKey>(conditions[0]?.key);
  const active = condition ?? internalCond;

  const byKey = useMemo(
    () => conditions.reduce((a, c) => { a[c.key] = c; return a; }, {} as Record<string, Condition>),
    [conditions]
  );

  const commit = useCallback((next: Chart) => {
    if (!value) setInternal(next);
    onChange?.(next);
  }, [value, onChange]);

  const markSurface = (fdi: number, code: SurfaceCode) => {
    if (readOnly) return;
    const rec: ToothChartEntry = { ...chart[fdi], surfaces: { ...(chart[fdi]?.surfaces ?? {}) } };
    if (rec.surfaces![code] === active) delete rec.surfaces![code];
    else rec.surfaces![code] = active;
    commit({ ...chart, [fdi]: rec });
  };

  const markTooth = (fdi: number, g: ToothGeometry) => {
    onSelectTooth?.(fdi, g);
    if (readOnly) return;
    const rec: ToothChartEntry = { ...chart[fdi], surfaces: { ...(chart[fdi]?.surfaces ?? {}) } };
    rec.whole = rec.whole === active ? null : active;
    commit({ ...chart, [fdi]: rec });
  };

  const rows: Array<{ arch: 'upper' | 'lower'; right: number[]; left: number[] }> = [];
  if (dentition !== 'primary') {
    rows.push({ arch: 'upper', right: FDI_UPPER.slice(0, 8), left: FDI_UPPER.slice(8) });
    rows.push({ arch: 'lower', right: FDI_LOWER.slice(0, 8), left: FDI_LOWER.slice(8) });
  }
  if (dentition !== 'permanent') {
    rows.splice(dentition === 'mixed' ? 1 : 0, 0,
      { arch: 'upper', right: FDI_UPPER_PRIMARY.slice(0, 5), left: FDI_UPPER_PRIMARY.slice(5) });
    rows.push({ arch: 'lower', right: FDI_LOWER_PRIMARY.slice(0, 5), left: FDI_LOWER_PRIMARY.slice(5) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: theme.ink }}>
      {showToolbar && !readOnly && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {conditions.map(c => {
            const on = c.key === active;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => { onConditionChange ? onConditionChange(c.key) : setInternalCond(c.key); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  padding: '7px 13px', border: `1px solid ${on ? theme.ink : theme.ink + '2E'}`,
                  background: on ? '#EFE9DC' : 'transparent', color: theme.ink,
                  font: `500 12px/1 ${theme.mono}`
                }}
              >
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: c.color }} />
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      <div style={{
        background: theme.surface, border: `1px solid ${theme.ink}22`,
        padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 4
      }}>
        {rows.map((row, i) => (
          <React.Fragment key={`${row.arch}-${i}-${row.right[0]}`}>
            {i > 0 && rows[i - 1].arch !== row.arch && (
              <div style={{ borderTop: `1px dashed ${theme.ink}33`, margin: '10px 0' }} />
            )}
            <ArchRow
              row={row}
              chart={chart}
              byKey={byKey}
              theme={theme}
              readOnly={readOnly}
              onSurface={markSurface}
              onTooth={markTooth}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function ArchRow({ row, chart, byKey, theme, readOnly, onSurface, onTooth }: {
  row: { arch: 'upper' | 'lower'; right: number[]; left: number[] };
  chart: Chart;
  byKey: Record<string, Condition>;
  theme: Theme;
  readOnly: boolean;
  onSurface: (fdi: number, code: SurfaceCode) => void;
  onTooth: (fdi: number, g: ToothGeometry) => void;
}) {
  const cols = `repeat(${row.right.length},1fr) 1px repeat(${row.left.length},1fr)`;
  const grid = (children: React.ReactNode, align: 'end' | 'start' = 'end') => (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 9, alignItems: align }}>{children}</div>
  );
  const divider = <div key="div" style={{ borderLeft: `1px dashed ${theme.ink}40`, minHeight: 30, height: '100%' }} />;
  const all = [...row.right, null, ...row.left];

  const teeth = all.map((fdi, k) => fdi === null ? divider : (
    <ToothCell
      key={fdi}
      fdi={fdi}
      entry={chart[fdi]}
      byKey={byKey}
      theme={theme}
      readOnly={readOnly}
      labelBelow={row.arch === 'lower'}
      onTooth={onTooth}
    />
  ));

  const wheels = all.map((fdi, k) => fdi === null ? <div key="dv" /> : (
    <SurfaceWheel
      key={fdi}
      fdi={fdi}
      entry={chart[fdi]}
      byKey={byKey}
      theme={theme}
      readOnly={readOnly}
      onSurface={onSurface}
    />
  ));

  return row.arch === 'upper'
    ? <>{grid(teeth, 'end')}<div style={{ padding: '10px 0 4px' }}>{grid(wheels, 'center' as 'end')}</div></>
    : <><div style={{ padding: '4px 0 10px' }}>{grid(wheels, 'center' as 'end')}</div>{grid(teeth, 'start')}</>;
}

function ToothCell({ fdi, entry, byKey, theme, readOnly, labelBelow, onTooth }: {
  fdi: number; entry?: ToothChartEntry; byKey: Record<string, Condition>; theme: Theme;
  readOnly: boolean; labelBelow: boolean; onTooth: (fdi: number, g: ToothGeometry) => void;
}) {
  const g = useMemo(() => toothGeometry(fdi), [fdi]);
  const whole = entry?.whole ? byKey[entry.whole] : null;
  const ghost = !!whole?.ghost;
  const label = (
    <div style={{ font: `500 13px/1 ${theme.mono}`, color: whole ? whole.color : theme.ink }}>{fdi}</div>
  );
  const svg = (
    <svg
      viewBox={g.viewBox}
      onClick={() => onTooth(fdi, g)}
      style={{ width: '100%', height: 'auto', cursor: readOnly ? 'default' : 'pointer', overflow: 'visible' }}
      role="button"
      aria-label={`${fdi} ${g.name}${whole ? ` — ${whole.label}` : ''}`}
    >
      <g transform={g.transform}>
        <path
          d={g.d}
          fill={whole?.toothFill ?? theme.enamel}
          fillOpacity={ghost ? 0.16 : 1}
          stroke={ghost ? theme.ink + '55' : theme.ink}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        <path d={g.cej} fill="none" stroke={theme.ink + '55'} strokeWidth={1.1} />
      </g>
      {ghost && <path d="M 34 92 L 98 200 M 98 92 L 34 200" stroke={theme.accent} strokeWidth={4} fill="none" />}
    </svg>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {labelBelow ? <>{svg}{label}</> : <>{label}{svg}</>}
    </div>
  );
}

function SurfaceWheel({ fdi, entry, byKey, theme, readOnly, onSurface }: {
  fdi: number; entry?: ToothChartEntry; byKey: Record<string, Condition>; theme: Theme;
  readOnly: boolean; onSurface: (fdi: number, code: SurfaceCode) => void;
}) {
  const g = useMemo(() => toothGeometry(fdi), [fdi]);
  const wedges = useMemo(
    () => surfaceWedges({ side: g.side, anterior: isAnterior(fdi) }),
    [g.side, fdi]
  );
  const fillOf = (code: SurfaceCode) => {
    const key = entry?.surfaces?.[code];
    return key && byKey[key] ? byKey[key].color : theme.paper;
  };
  const cursor = readOnly ? 'default' : 'pointer';
  return (
    <svg viewBox="-18 -18 36 36" style={{ width: '100%', height: 'auto' }}>
      {wedges.map(w => w.d ? (
        <path
          key={w.code}
          d={w.d}
          fill={fillOf(w.code)}
          stroke={theme.ink}
          strokeWidth={0.7}
          style={{ cursor }}
          onClick={() => onSurface(fdi, w.code)}
        >
          <title>{`${fdi} ${SURFACE_NAMES[w.code]}`}</title>
        </path>
      ) : (
        <circle
          key={w.code}
          r={w.r}
          fill={fillOf(w.code)}
          stroke={theme.ink}
          strokeWidth={0.7}
          style={{ cursor }}
          onClick={() => onSurface(fdi, w.code)}
        >
          <title>{`${fdi} ${SURFACE_NAMES[w.code]}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- */

export interface Finding {
  fdi: number;
  scope: 'tooth' | 'surface';
  surface?: SurfaceCode;
  surfaceName?: string;
  condition: ConditionKey;
}

/** Flatten a chart into a list you can render, diff, or POST. */
export function chartToFindings(chart: Chart): Finding[] {
  const out: Finding[] = [];
  Object.keys(chart).sort((a, b) => Number(a) - Number(b)).forEach(k => {
    const rec = chart[k] ?? {};
    const fdi = Number(k);
    if (rec.whole) out.push({ fdi, scope: 'tooth', condition: rec.whole });
    Object.entries(rec.surfaces ?? {}).forEach(([code, cond]) => {
      if (!cond) return;
      out.push({
        fdi, scope: 'surface',
        surface: code as SurfaceCode,
        surfaceName: SURFACE_NAMES[code as SurfaceCode],
        condition: cond
      });
    });
  });
  return out;
}

export default Odontogram;
