"use client";

import { useState } from "react";
import { CheckIcon, PlusIcon } from "../components/icons";

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
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
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
        {[...options, ...customOptions].map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              aria-pressed={on}
              className={`choice flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[0.82rem] font-semibold ${
                on ? "text-ink" : "text-ink-2"
              }`}
              data-on={on}
            >
              {on && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
              {opt}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowCustomInput(true)}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3.5 py-2 text-[0.82rem] font-semibold text-ink-dim"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Custom
        </button>
      </div>

      {showCustomInput && (
        <div className="mt-2.5 flex gap-2">
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
            className="field flex-1 py-2.5 text-sm"
          />
          <button type="button" onClick={addCustom} className="btn btn-primary shrink-0 px-5">
            Add
          </button>
        </div>
      )}
    </div>
  );
}
