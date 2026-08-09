"use client";

import type { WeightPoint } from "./types";

const W = 320;
const H = 120;
const PAD = 6;

/** Weigh-ins against their smoothed trend.
 *
 * Hand-drawn SVG rather than a charting library: it's two polylines over a
 * shared scale, and a dependency would be more code than the maths.
 */
export default function WeightChart({
  points,
  unit,
  toDisplay,
}: {
  points: WeightPoint[];
  unit: string;
  toDisplay: (kg: number) => number;
}) {
  if (points.length < 2) return null;

  const raw = points.map((p) => toDisplay(p.weight_kg));
  const trend = points.map((p) => toDisplay(p.ema_kg));
  const all = [...raw, ...trend];
  const min = Math.min(...all);
  const max = Math.max(...all);
  // A flat series would divide by zero; give it an arbitrary band instead.
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const path = (values: number[]) => values.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  return (
    <div className="border border-border bg-surface p-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink-dim">Weight trend</span>
        <span className="text-xs text-ink-dim tabular-nums">
          {min.toFixed(1)}–{max.toFixed(1)} {unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Weight trend over ${points.length} weigh-ins`}
      >
        {/* Raw readings sit behind, faint: they're noise, not the story. */}
        <polyline
          points={path(raw)}
          fill="none"
          stroke="var(--ink-dim)"
          strokeWidth="1"
          opacity="0.45"
        />
        <polyline
          points={path(trend)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
        />
        {raw.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="1.8" fill="var(--ink-dim)" opacity="0.5" />
        ))}
      </svg>
      <p className="mt-1.5 text-xs text-ink-dim">
        Faint line is what the scale said. Solid line is the smoothed trend — the one worth
        reacting to.
      </p>
    </div>
  );
}
