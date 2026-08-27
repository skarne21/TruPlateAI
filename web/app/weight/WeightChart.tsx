"use client";

import type { WeightPoint } from "./types";

const W = 320;
const H = 130;
const PAD = 10;

/** Weigh-ins against their smoothed trend.
 *
 * Hand-drawn SVG rather than a charting library: it's two polylines and a
 * fill over a shared scale, and a dependency would be more code than the
 * maths.
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

  const change = trend[trend.length - 1] - trend[0];
  const direction = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";

  return (
    <div className="card px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[0.8rem] font-extrabold text-ink">Weight trend</span>
        <span
          className={`pill tabular-nums ${
            direction === "flat" ? "bg-surface-2 text-ink-dim" : "bg-accent/12 text-accent"
          }`}
        >
          {direction === "up" ? "▲" : direction === "down" ? "▼" : "→"}{" "}
          {Math.abs(change).toFixed(1)} {unit}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Weight trend over ${points.length} weigh-ins, ${direction === "flat" ? "roughly level" : `${Math.abs(change).toFixed(1)} ${unit} ${direction}`}`}
      >
        <defs>
          <linearGradient id="weight-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The fill is what makes the direction readable at a glance, before
            anyone reads a number. */}
        <polygon
          points={`${PAD},${H - PAD} ${path(trend)} ${W - PAD},${H - PAD}`}
          fill="url(#weight-fill)"
        />

        {/* Raw readings sit behind, faint: they're noise, not the story. */}
        <polyline
          points={path(raw)}
          fill="none"
          stroke="var(--ink-dim)"
          strokeWidth="1"
          opacity="0.4"
        />
        <polyline
          points={path(trend)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {raw.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="1.8" fill="var(--ink-dim)" opacity="0.45" />
        ))}
        <circle
          cx={x(points.length - 1)}
          cy={y(trend[trend.length - 1])}
          r="4"
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth="2"
        />
      </svg>

      <div className="mt-2 flex items-center justify-between text-[0.68rem] text-ink-dim tabular-nums">
        <span>
          {min.toFixed(1)}–{max.toFixed(1)} {unit}
        </span>
        <span>{points.length} weigh-ins</span>
      </div>
      <p className="mt-2 text-[0.72rem] text-ink-dim">
        Faint line is what the scale said. Solid line is the smoothed trend — the one worth
        reacting to.
      </p>
    </div>
  );
}
