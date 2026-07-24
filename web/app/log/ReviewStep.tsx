"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import AddItem from "./AddItem";
import {
  LOW_CONFIDENCE,
  round,
  type AnalyzeResult,
  type FatAnswer,
  type Question,
  type ResolvedItem,
  type Totals,
} from "./types";

export default function ReviewStep({
  result,
  items,
  totals,
  onChange,
  onConfirm,
  saving,
}: {
  result: AnalyzeResult;
  items: ResolvedItem[];
  totals: Totals;
  onChange: (items: ResolvedItem[], totals: Totals) => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a fat photo has identified the oil but not the amount -- the
  // options stay up, now priced for the fat we actually found.
  const [identifiedFat, setIdentifiedFat] = useState<Record<string, string>>({});

  async function clarify(body: Record<string, unknown>, questionId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/analyze/clarify", {
        method: "POST",
        body: JSON.stringify({ items, ...body }),
      });
      if (!res.ok) throw new Error(`Couldn't apply that (${res.status})`);
      const data = await res.json();
      onChange(data.items, data.totals);
      setAnswered((prev) => new Set(prev).add(questionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function answerOption(question: Question, optionIndex: number) {
    clarify(
      question.reason === "hidden_fat"
        ? {
            reason: "hidden_fat",
            option_index: optionIndex,
            fat_name: identifiedFat[question.id] ?? "vegetable oil",
          }
        : {
            reason: "portion",
            option_index: optionIndex,
            item_name: question.affects_items[0] ?? items[0]?.name,
          },
      question.id
    );
  }

  async function answerWithPhoto(question: Question, file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", await downscaleImage(file), "fat.jpg");
      const res = await apiFetch("/analyze/fat-photo", { method: "POST", body: form });
      if (!res.ok) throw new Error(`Couldn't read that photo (${res.status})`);
      const fat: FatAnswer = await res.json();

      if (fat.grams === null) {
        // The photo showed what the fat is but not how much. Keep asking the
        // amount rather than inventing one.
        setIdentifiedFat((prev) => ({ ...prev, [question.id]: fat.fat_name }));
        setBusy(false);
        return;
      }
      await clarify(
        { reason: "hidden_fat", fat_name: fat.fat_name, grams: fat.grams },
        question.id
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  function updateGrams(index: number, grams: number) {
    // Macros are linear in grams, so scaling the existing numbers is exact and
    // saves a round-trip. The server re-sums the meal totals from these items
    // on /log, so the stored total always matches the submitted parts.
    const item = items[index];
    const factor = item.grams > 0 ? grams / item.grams : 0;
    const scaled: ResolvedItem = {
      ...item,
      grams,
      kcal: item.kcal === null ? null : item.kcal * factor,
      protein_g: item.protein_g === null ? null : item.protein_g * factor,
      carbs_g: item.carbs_g === null ? null : item.carbs_g * factor,
      fat_g: item.fat_g === null ? null : item.fat_g * factor,
    };
    replace(items.map((it, i) => (i === index ? scaled : it)));
  }

  function replace(next: ResolvedItem[]) {
    onChange(next, {
      kcal: next.reduce((sum, i) => sum + (i.kcal ?? 0), 0),
      protein_g: next.reduce((sum, i) => sum + (i.protein_g ?? 0), 0),
      carbs_g: next.reduce((sum, i) => sum + (i.carbs_g ?? 0), 0),
      fat_g: next.reduce((sum, i) => sum + (i.fat_g ?? 0), 0),
    });
  }

  const openQuestions = result.questions.filter((q) => !answered.has(q.id));

  return (
    <div>
      <p className="mb-1 text-xs font-bold tracking-widest text-accent uppercase">Review</p>
      <h1 className="mb-4 text-xl font-extrabold text-ink">{result.meal_summary}</h1>

      <div className="mb-4 border border-border bg-surface p-5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-extrabold tracking-tight text-ink tabular-nums">
            {round(totals.kcal).toLocaleString()}
          </span>
          <span className="text-sm font-bold text-ink-dim">kcal</span>
        </div>
        <p className="mt-1 text-sm text-ink-dim tabular-nums">
          {round(totals.protein_g)}g protein · {round(totals.carbs_g)}g carbs ·{" "}
          {round(totals.fat_g)}g fat
        </p>
      </div>

      {result.warnings.map((warning) => (
        <p key={warning} className="mb-2 border border-warn/40 bg-warn/10 p-3 text-xs font-medium text-ink">
          {warning}
        </p>
      ))}

      {openQuestions.map((question) => (
        <QuestionCard
          key={question.id}
          question={question}
          identifiedFat={identifiedFat[question.id]}
          busy={busy}
          onOption={(i) => answerOption(question, i)}
          onPhoto={(file) => answerWithPhoto(question, file)}
        />
      ))}

      {error && <p className="mb-3 text-sm font-semibold text-warn">{error}</p>}

      <div className="mb-3 flex flex-col gap-2">
        {items.map((item, index) => (
          <ItemRow
            key={`${item.name}-${index}`}
            item={item}
            onGrams={(grams) => updateGrams(index, grams)}
            onRemove={() => replace(items.filter((_, i) => i !== index))}
          />
        ))}
      </div>

      <AddItem onAdd={(item) => replace([...items, item])} />

      <button
        type="button"
        onClick={onConfirm}
        disabled={saving || busy || items.length === 0}
        className="mt-5 w-full bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
      >
        {saving ? "Logging..." : "Log this meal"}
      </button>
    </div>
  );
}

function QuestionCard({
  question,
  identifiedFat,
  busy,
  onOption,
  onPhoto,
}: {
  question: Question;
  identifiedFat?: string;
  busy: boolean;
  onOption: (index: number) => void;
  onPhoto: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mb-3 border border-accent/50 bg-accent/5 p-4">
      <p className="text-sm font-bold text-ink">{question.question}</p>
      <p className="mt-0.5 mb-3 text-xs text-ink-dim">{question.kcal_impact}</p>

      {identifiedFat && (
        <p className="mb-3 border border-good/40 bg-good/10 p-2 text-xs font-semibold text-ink">
          Found {identifiedFat} in your photo — how much went in?
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {question.options.map((option) => (
          <button
            key={option.index}
            type="button"
            disabled={busy}
            onClick={() => onOption(option.index)}
            className="border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-ink disabled:opacity-40 hover:border-accent"
          >
            {option.label}
          </button>
        ))}
      </div>

      {question.reason === "hidden_fat" && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="mt-2 border border-dashed border-border px-3.5 py-2 text-sm font-semibold text-ink-dim disabled:opacity-40"
          >
            {busy ? "Reading photo..." : "or photograph what you used"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPhoto(file);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onGrams,
  onRemove,
}: {
  item: ResolvedItem;
  onGrams: (grams: number) => void;
  onRemove: () => void;
}) {
  const uncertain = item.confidence < LOW_CONFIDENCE;

  return (
    <div className={`border bg-surface p-3.5 ${uncertain ? "border-warn" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="block text-sm font-bold text-ink">{item.name}</b>
          {/* Showing the matched USDA entry is the real defence against a wrong
              match -- USDA has no "poha", so it returns a groundcherry entry that
              shares the word, and only a visible description makes that obvious. */}
          <small className="block truncate text-xs text-ink-dim">
            {item.source === "usda"
              ? item.usda_description
              : item.source === "user"
                ? "added by you"
                : "AI estimate — no database match"}
          </small>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className="shrink-0 border border-border px-2 py-1 text-xs font-bold text-ink-dim"
        >
          Remove
        </button>
      </div>

      {uncertain && (
        <p className="mt-2 border border-warn/50 bg-warn/10 px-2 py-1.5 text-xs font-bold text-ink">
          Not sure about this one — worth a check
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={Math.round(item.grams)}
          onChange={(e) => onGrams(Math.max(0, Number(e.target.value) || 0))}
          className="w-20 border border-border bg-surface px-2 py-1.5 text-sm text-ink tabular-nums"
        />
        <span className="text-xs font-semibold text-ink-dim">grams</span>
        <span className="ml-auto text-sm font-extrabold text-ink tabular-nums">
          {round(item.kcal)} kcal
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-dim tabular-nums">
        {round(item.protein_g)}p · {round(item.carbs_g)}c · {round(item.fat_g)}f
      </p>
    </div>
  );
}
