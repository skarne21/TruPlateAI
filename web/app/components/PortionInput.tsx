"use client";

import { useState } from "react";
import { gramsPerUnit, type ResolvedItem } from "../log/types";

/** Set a portion in the unit a person would actually say.
 *
 * Grams are what the macro maths needs -- USDA is per 100g -- but nobody
 * measures milk in grams. The conversion comes from the item's own analysis
 * ("1 cup = 244 g") rather than a density table, so it is right for this food
 * rather than approximately right for a category, and needs no new data.
 *
 * The ratio is frozen on first render -- see the note on the state below.
 */
export default function PortionInput({
  item,
  onChange,
  label,
}: {
  item: ResolvedItem;
  onChange: (grams: number) => void;
  label: string;
}) {
  // Held in state with a lazy initialiser rather than a ref: this value is
  // used for rendering, so it belongs in the render path. Computed once at
  // mount because recomputing it from the live item would divide by zero the
  // moment someone clears the field to type a new number.
  const [ratio] = useState(() => gramsPerUnit(item));
  const unit = (item.unit || "").trim();
  const [showGrams, setShowGrams] = useState(ratio <= 0);

  // Nothing better than grams is known for this item, so don't offer a choice
  // that isn't one.
  if (ratio <= 0) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={Math.round(item.grams)}
          aria-label={label}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="field w-20 px-2 py-1.5 text-center text-sm tabular-nums"
        />
        <span className="text-[0.75rem] font-bold text-ink-dim">grams</span>
      </div>
    );
  }

  const shown = showGrams
    ? Math.round(item.grams)
    : Math.round((item.grams / ratio) * 100) / 100;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        step={showGrams ? 1 : 0.25}
        inputMode="decimal"
        value={shown}
        aria-label={label}
        onChange={(e) => {
          const typed = Math.max(0, Number(e.target.value) || 0);
          onChange(showGrams ? typed : typed * ratio);
        }}
        className="field w-20 px-2 py-1.5 text-center text-sm tabular-nums"
      />

      {/* A native select: it is one line, it is keyboard and screen-reader
          correct for free, and it opens as the platform's own picker on a
          phone. A custom dropdown would be worse in all three ways. */}
      <select
        value={showGrams ? "g" : "unit"}
        aria-label={`Unit for ${label}`}
        onChange={(e) => setShowGrams(e.target.value === "g")}
        className="field w-auto py-1.5 pr-7 pl-2 text-sm font-bold"
      >
        <option value="unit">{unit}</option>
        <option value="g">grams</option>
      </select>

      {/* The other number stays visible either way, so switching units is
          never a guess about what you just typed. */}
      <span className="text-[0.72rem] text-ink-dim tabular-nums">
        {showGrams
          ? `= ${Math.round((item.grams / ratio) * 100) / 100} ${unit}`
          : `= ${Math.round(item.grams)} g`}
      </span>
    </div>
  );
}
