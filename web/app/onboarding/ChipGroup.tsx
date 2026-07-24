"use client";

import { useState } from "react";

export default function ChipGroup({
  options,
  selected,
  onChange,
  customPlaceholder,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  customPlaceholder: string;
}) {
  const [customOptions, setCustomOptions] = useState<string[]>(
    selected.filter((s) => !options.includes(s))
  );
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customText, setCustomText] = useState("");

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  }

  function addCustom() {
    const txt = customText.trim();
    if (!txt) return;
    if (!customOptions.includes(txt)) setCustomOptions((prev) => [...prev, txt]);
    if (!selected.includes(txt)) onChange([...selected, txt]);
    setCustomText("");
    setShowCustomInput(false);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {[...options, ...customOptions].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`border px-3.5 py-2 text-sm font-semibold ${
              selected.includes(opt)
                ? "border-accent bg-accent text-[#1a1006]"
                : "border-border bg-surface text-ink hover:border-accent-2"
            }`}
          >
            {opt}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustomInput(true)}
          className="border border-dashed border-border px-3.5 py-2 text-sm font-semibold text-ink-dim"
        >
          + Custom
        </button>
      </div>
      {showCustomInput && (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder={customPlaceholder}
            className="flex-1 border border-border bg-surface px-3 py-2 text-sm text-ink"
          />
          <button
            type="button"
            onClick={addCustom}
            className="border border-accent bg-accent px-3.5 py-2 text-sm font-bold text-[#1a1006]"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
