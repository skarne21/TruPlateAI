"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { PlusIcon } from "../components/icons";
import { Notice } from "../components/ui";
import type { ResolvedItem, UsdaCandidate } from "./types";

const DEFAULT_GRAMS = 100;

/** Add a food the photo missed: search USDA, see the match, then add it.
 *
 * The candidate list shows the actual USDA description before anything is
 * added, so the user picks a real database entry rather than trusting a
 * lookup they can't see.
 */
export default function AddItem({ onAdd }: { onAdd: (item: ResolvedItem) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UsdaCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const res = await apiFetch(`/usda/search?query=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      setResults(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function add(candidate: UsdaCandidate) {
    const scale = DEFAULT_GRAMS / 100;
    const per100 = (value: number | null) => (value === null ? null : value * scale);
    onAdd({
      name: candidate.description,
      usda_query: query.trim(),
      grams: DEFAULT_GRAMS,
      count: 1,
      unit: "serving",
      confidence: 1,
      source: "usda",
      usda_fdc_id: candidate.fdc_id,
      usda_description: candidate.description,
      kcal: per100(candidate.kcal_per_100g),
      protein_g: per100(candidate.protein_per_100g),
      carbs_g: per100(candidate.carbs_per_100g),
      fat_g: per100(candidate.fat_per_100g),
    });
    setOpen(false);
    setQuery("");
    setResults(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong py-3.5 text-[0.85rem] font-bold text-ink-dim transition-transform active:scale-[0.98]"
      >
        <PlusIcon className="h-4 w-4" />
        Add something the photo missed
      </button>
    );
  }

  return (
    <div className="card rise px-4 py-4">
      <div className="flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="e.g. filter coffee with milk"
          className="field flex-1"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="btn btn-primary shrink-0 px-5"
        >
          {searching ? "…" : "Search"}
        </button>
      </div>

      {error && (
        <div className="mt-2">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      {results?.length === 0 && (
        <p className="mt-3 text-[0.78rem] text-ink-dim">Nothing in USDA matched that.</p>
      )}

      {results && results.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {results.map((candidate) => (
            <button
              key={candidate.fdc_id}
              type="button"
              onClick={() => add(candidate)}
              className="choice px-3 py-2.5 text-left"
            >
              <b className="block text-[0.85rem] font-semibold text-ink">
                {candidate.description}
              </b>
              <small className="text-[0.72rem] text-ink-dim tabular-nums">
                {candidate.kcal_per_100g === null
                  ? "no calorie data"
                  : `${Math.round(candidate.kcal_per_100g)} kcal / 100g`}
              </small>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-3 w-full py-2 text-[0.78rem] font-bold text-ink-dim"
      >
        Cancel
      </button>
    </div>
  );
}
