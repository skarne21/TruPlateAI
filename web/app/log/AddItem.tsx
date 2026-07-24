"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
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
      kcal: candidate.kcal_per_100g === null ? null : candidate.kcal_per_100g * scale,
      protein_g: candidate.protein_per_100g === null ? null : candidate.protein_per_100g * scale,
      carbs_g: null,
      fat_g: null,
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
        className="w-full border border-dashed border-border px-3.5 py-2.5 text-sm font-semibold text-ink-dim"
      >
        + Add something the photo missed
      </button>
    );
  }

  return (
    <div className="border border-border bg-surface p-3.5">
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
          className="flex-1 border border-border bg-surface px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="border border-accent bg-accent px-3.5 py-2 text-sm font-bold text-[#1a1006] disabled:opacity-40"
        >
          {searching ? "..." : "Search"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-warn">{error}</p>}

      {results?.length === 0 && (
        <p className="mt-2 text-xs text-ink-dim">Nothing in USDA matched that.</p>
      )}

      {results && results.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {results.map((candidate) => (
            <button
              key={candidate.fdc_id}
              type="button"
              onClick={() => add(candidate)}
              className="border border-border p-2.5 text-left hover:border-accent"
            >
              <b className="block text-sm font-semibold text-ink">{candidate.description}</b>
              <small className="text-xs text-ink-dim tabular-nums">
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
        className="mt-2 text-xs font-bold text-ink-dim underline underline-offset-2"
      >
        Cancel
      </button>
    </div>
  );
}
