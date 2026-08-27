"use client";

import { useEffect, useState } from "react";
import { CountUp } from "./ui";

const SIZE = 220;
const STROKE = 16;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/** The calorie ring: the one thing on the dashboard you should be able to
 *  read from arm's length.
 *
 *  It draws itself from empty on mount. That sweep is the point -- a static
 *  arc states a fact, a filling one shows progress being made.
 */
export function CalorieRing({
  consumed,
  target,
  className = "",
}: {
  consumed: number;
  target: number;
  className?: string;
}) {
  const [drawn, setDrawn] = useState(0);
  const ratio = target > 0 ? consumed / target : 0;
  const over = ratio > 1;
  const remaining = Math.round(target - consumed);

  useEffect(() => {
    // One frame of empty ring first, so the transition has something to run
    // from. Setting it during render would land already-filled.
    const id = requestAnimationFrame(() => setDrawn(Math.min(ratio, 1)));
    return () => cancelAnimationFrame(id);
  }, [ratio]);

  // "Nearly there" is the most motivating state there is, so it gets its own
  // colour rather than being lumped in with "not done".
  const state = over ? "over" : ratio >= 0.9 ? "close" : "going";

  return (
    <div className={`relative ${className}`} style={{ width: SIZE, height: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
          <linearGradient id="ring-over" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--warn)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>

        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--track)"
          strokeWidth={STROKE}
        />
        <circle
          className="ring-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={over ? "url(#ring-over)" : "url(#ring-grad)"}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - drawn)}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <CountUp
          value={Math.abs(remaining)}
          className="text-[3.25rem] leading-none font-extrabold tracking-tight text-ink"
        />
        <span className="mt-1 text-xs font-bold tracking-wide text-ink-dim uppercase">
          kcal {over ? "over" : "left"}
        </span>
        <span
          className={`pill mt-2.5 ${
            state === "over"
              ? "bg-warn/12 text-warn"
              : state === "close"
                ? "bg-good/12 text-good"
                : "bg-surface-2 text-ink-dim"
          }`}
        >
          {Math.round(consumed).toLocaleString()} / {Math.round(target).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

type Macro = { key: string; label: string; value: number; target: number; color: string };

/** Protein, carbs and fat as three filling bars.
 *
 *  Colour never carries the meaning on its own -- every bar states its grams
 *  and its target in text, which is what makes it readable to a colourblind
 *  user and in a screenshot.
 */
export function MacroBars({
  consumed,
  targets,
  className = "",
}: {
  consumed: Record<string, number>;
  targets: Record<string, number>;
  className?: string;
}) {
  const macros: Macro[] = [
    {
      key: "protein_g",
      label: "Protein",
      value: consumed.protein_g ?? 0,
      target: targets.protein_g ?? 0,
      color: "var(--protein)",
    },
    {
      key: "carbs_g",
      label: "Carbs",
      value: consumed.carbs_g ?? 0,
      target: targets.carbs_g ?? 0,
      color: "var(--carbs)",
    },
    {
      key: "fat_g",
      label: "Fat",
      value: consumed.fat_g ?? 0,
      target: targets.fat_g ?? 0,
      color: "var(--fat)",
    },
  ];

  return (
    <div className={`grid grid-cols-3 gap-2.5 ${className}`}>
      {macros.map(({ key, ...m }) => (
        <MacroBar key={key} {...m} />
      ))}
    </div>
  );
}

function MacroBar({ label, value, target, color }: Omit<Macro, "key">) {
  const [width, setWidth] = useState(0);
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const hit = target > 0 && value >= target;

  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  return (
    <div className="card px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.7rem] font-bold text-ink-dim">{label}</span>
        {hit && <span className="text-[0.7rem]">✓</span>}
      </div>
      <p className="mt-1 text-lg leading-none font-extrabold text-ink tabular-nums">
        {Math.round(value)}
        <span className="text-[0.7rem] font-bold text-ink-dim">
          /{Math.round(target)}g
        </span>
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-track">
        <div
          className="bar-fill h-full rounded-full"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
    </div>
  );
}
