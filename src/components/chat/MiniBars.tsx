"use client";

import { barFill } from "./activity-words";

// A small bar chart in plain SVG (no chart library for two charts). Bars are keyed by label. Keys are shown to the reader through `label`, never raw. `full` is the value a full-height bar stands for
// (activity-words.ts barFull): 100 for a mood, the largest value for a count.

export function MiniBars({
  rows,
  full,
  format = (v) => String(v),
  label = (k) => k,
  height = 90,
}: {
  rows: { key: string; value: number }[];
  full?: number;
  format?: (v: number) => string;
  label?: (key: string) => string;
  height?: number;
}) {
  if (!rows.length) return null;
  const top = full ?? (Math.max(...rows.map((r) => r.value), 0) || 1);
  const w = 100 / rows.length;
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-20 w-full overflow-visible" role="img" aria-label="Bar chart">
        {rows.map((r, i) => {
          const h = barFill(r.value, top) * (height - 6);
          return (
            <g key={r.key}>
              <title>{`${label(r.key)}: ${format(r.value)}`}</title>
              <rect x={i * w + w * 0.14} y={height - h} width={w * 0.72} height={Math.max(h, 0.6)} rx={0.9} className="fill-pulse/75" />
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1.5 flex justify-between text-[12px] text-muted-foreground">
        <span>{label(rows[0].key)}</span>
        <span>{label(rows.at(-1)!.key)}</span>
      </figcaption>
    </figure>
  );
}
