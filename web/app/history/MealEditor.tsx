"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import AddItem from "../log/AddItem";
import { round, scaleItem, sumTotals, type ResolvedItem, type Totals } from "../log/types";
import { CheckIcon, TrashIcon } from "../components/icons";
import PortionInput from "../components/PortionInput";
import { Notice, haptic } from "../components/ui";
import type { LoggedItem, LoggedMeal } from "./types";

/** A stored item, back in the shape the rest of the app edits.
 *
 * The fields that can be null here are the ones added to the history response
 * so an edit round-trips faithfully. An older row that predates them falls
 * back to something honest rather than something flattering: confidence 1
 * would claim we were sure, so a missing one becomes 0.9 -- checked, but not
 * asserted.
 */
function toEditable(item: LoggedItem): ResolvedItem {
  return {
    name: item.name,
    usda_query: item.usda_query ?? item.name,
    grams: item.grams,
    count: item.count ?? 1,
    unit: item.unit ?? "g",
    confidence: item.confidence ?? 0.9,
    source: (item.source as ResolvedItem["source"]) ?? "llm",
    usda_fdc_id: item.usda_fdc_id ?? null,
    usda_description: item.usda_description ?? null,
    kcal: item.kcal,
    protein_g: item.protein_g,
    carbs_g: item.carbs_g,
    fat_g: item.fat_g,
  };
}

export default function MealEditor({
  meal,
  onCancel,
  onSaved,
}: {
  meal: LoggedMeal;
  onCancel: () => void;
  onSaved: (items: ResolvedItem[], caption: string | null, totals: Totals) => void;
}) {
  const [items, setItems] = useState<ResolvedItem[]>(meal.items.map(toEditable));
  const [caption, setCaption] = useState(meal.caption ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = sumTotals(items);
  const changed =
    items.length !== meal.items.length ||
    caption !== (meal.caption ?? "") ||
    items.some((item, i) => item.grams !== meal.items[i]?.grams);

  async function save() {
    if (items.length === 0) {
      // The server refuses this too; saying so here saves a round trip and
      // explains the alternative, which is what the user actually wants.
      setError("A meal needs at least one item. Delete the whole meal instead?");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/meals/${meal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ items, caption: caption.trim() || null }),
      });
      if (!res.ok) throw new Error(`Couldn't save that edit (${res.status})`);
      // The server re-sums from the items it stored, so its totals are the
      // ones to believe -- not the running total on screen.
      const { totals: saved } = await res.json();
      haptic([10, 40, 10]);
      onSaved(items, caption.trim() || null, saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that edit");
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-border bg-surface-2 px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[0.72rem] font-bold text-ink-dim">Editing</span>
        <span className="text-[0.85rem] font-extrabold text-ink tabular-nums">
          {round(totals.kcal).toLocaleString()} kcal
        </span>
      </div>

      <div className="mb-3 flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="card px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <b className="min-w-0 flex-1 text-[0.82rem] font-bold text-ink">{item.name}</b>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                aria-label={`Remove ${item.name}`}
                className="shrink-0 rounded-lg p-1 text-ink-dim"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PortionInput
                item={item}
                label={`Portion of ${item.name}`}
                onChange={(grams) =>
                  setItems((prev) => prev.map((it, i) => (i === index ? scaleItem(it, grams) : it)))
                }
              />
              <span className="ml-auto text-[0.82rem] font-extrabold text-ink tabular-nums">
                {round(item.kcal)} kcal
              </span>
            </div>
          </div>
        ))}
      </div>

      <label className="mb-1.5 block text-[0.72rem] font-bold text-ink-dim">Note</label>
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="What this meal was"
        className="field mb-3 py-2.5 text-sm"
      />

      <AddItem onAdd={(item) => setItems((prev) => [...prev, item])} />

      {error && (
        <div className="mt-3">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !changed}
          className="btn btn-primary min-h-11 flex-1 text-[0.85rem]"
        >
          <CheckIcon className="h-4 w-4" />
          {saving ? "Saving…" : changed ? "Save changes" : "No changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn btn-ghost min-h-11 px-5 text-[0.85rem]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
