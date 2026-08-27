"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import { CameraIcon, CheckIcon, SparkIcon, TrashIcon } from "../components/icons";
import { CountUp, Notice, haptic } from "../components/ui";
import AddItem from "./AddItem";
import {
  LOW_CONFIDENCE,
  round,
  scaleItem,
  sumTotals,
  type AnalyzeResult,
  type FatAnswer,
  type Question,
  type ResolvedItem,
  type Totals,
} from "./types";

/** Where each number came from, said plainly.
 *
 * This label is the app's whole honesty pitch in one line: a USDA row, a
 * printed label, your own correction, or an estimate we admit to. */
const SOURCE_STYLE: Record<string, { label: string; className: string }> = {
  barcode: { label: "From the label", className: "bg-good/12 text-good" },
  usda: { label: "USDA", className: "bg-protein/12 text-protein" },
  user: { label: "Your food", className: "bg-carbs/12 text-carbs" },
  llm: { label: "AI estimate", className: "bg-fat/15 text-fat" },
};

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
  const [usedMemory, setUsedMemory] = useState(false);
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
      haptic();
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

      if (!fat.fat_name) {
        setError("Couldn't spot any oil or butter in that photo — pick an amount below.");
        setBusy(false);
        return;
      }
      if (fat.grams === null) {
        // The photo showed what the fat is but not how much. Keep asking the
        // amount rather than inventing one.
        setIdentifiedFat((prev) => ({ ...prev, [question.id]: fat.fat_name! }));
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
    replace(items.map((it, i) => (i === index ? scaleItem(it, grams) : it)));
  }

  function replace(next: ResolvedItem[]) {
    onChange(next, sumTotals(next));
  }

  const openQuestions = result.questions.filter((q) => !answered.has(q.id));

  return (
    <div className="pb-28">
      {/* The running total updates as you edit, so a correction shows its
          effect immediately instead of after you commit. */}
      <section className="card card-lift rise mb-3 px-5 py-5 text-center">
        <p className="text-[0.75rem] font-bold text-ink-dim">{result.meal_summary}</p>
        <p className="mt-2 text-5xl leading-none font-extrabold tracking-tight text-ink">
          <CountUp value={round(totals.kcal)} />
          <span className="text-base font-bold text-ink-dim"> kcal</span>
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Protein", value: totals.protein_g, color: "bg-protein" },
            { label: "Carbs", value: totals.carbs_g, color: "bg-carbs" },
            { label: "Fat", value: totals.fat_g, color: "bg-fat" },
          ].map((m) => (
            <div key={m.label} className="rounded-xl bg-surface-2 px-2 py-2">
              <span className={`mx-auto mb-1 block h-1 w-6 rounded-full ${m.color}`} />
              <p className="text-sm font-extrabold text-ink tabular-nums">{round(m.value)}g</p>
              <p className="text-[0.65rem] font-bold text-ink-dim">{m.label}</p>
            </div>
          ))}
        </div>
      </section>

      {result.similar_meal && !usedMemory && (
        <div className="card rise mb-3 border-good/40 bg-good/8 px-4 py-4">
          <div className="flex items-center gap-2">
            <SparkIcon className="h-5 w-5 shrink-0 text-good" />
            <b className="text-sm font-extrabold text-ink">You&apos;ve logged this before</b>
          </div>
          <p className="mt-1.5 text-[0.78rem] text-ink-dim">
            &ldquo;{result.similar_meal.summary}&rdquo;
            {result.similar_meal.logged_on && ` on ${result.similar_meal.logged_on}`} —{" "}
            {round(result.similar_meal.totals.kcal)} kcal with your own corrections.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              // Replaces the fresh analysis with the numbers this user already
              // checked and fixed. Their corrections beat a new estimate.
              onChange(result.similar_meal!.items, result.similar_meal!.totals);
              setUsedMemory(true);
              haptic([10, 40, 10]);
            }}
            className="btn mt-3 w-full bg-good text-[#04150f]"
          >
            <CheckIcon className="h-4 w-4" />
            Log my usual instead
          </button>
        </div>
      )}

      {usedMemory && (
        <div className="mb-3">
          <Notice tone="good">
            Using your saved numbers from last time. Everything below is still editable.
          </Notice>
        </div>
      )}

      {result.warnings.map((warning) => (
        <div key={warning} className="mb-2">
          <Notice tone="warn">{warning}</Notice>
        </div>
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

      {error && (
        <div className="mb-3">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      <h2 className="mb-2 px-1 text-sm font-extrabold text-ink">
        {items.length} {items.length === 1 ? "item" : "items"}
      </h2>

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

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/90 px-4 pt-3 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving || busy || items.length === 0}
            className="btn btn-primary w-full"
          >
            {saving ? "Logging…" : `Log ${round(totals.kcal).toLocaleString()} kcal`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A clarifying question. Bounded to three, only asked when real calories are
 *  at stake, and always answerable with one tap. */
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
    <div className="card rise mb-3 border-accent/40 bg-accent/6 px-4 py-4">
      <span className="pill mb-2 bg-accent/15 text-accent">Quick question</span>
      <p className="text-[0.92rem] font-bold text-ink">{question.question}</p>
      <p className="mt-1 mb-3 text-[0.75rem] text-ink-dim">{question.kcal_impact}</p>

      {identifiedFat && (
        <div className="mb-3">
          <Notice tone="good">Found {identifiedFat} in your photo — how much went in?</Notice>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {question.options.map((option) => (
          <button
            key={option.index}
            type="button"
            disabled={busy}
            onClick={() => onOption(option.index)}
            className="choice min-h-11 px-4 py-2.5 text-[0.85rem] font-bold text-ink disabled:opacity-40"
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
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong py-2.5 text-[0.8rem] font-bold text-ink-dim disabled:opacity-40"
          >
            <CameraIcon className="h-4 w-4" />
            {busy ? "Reading photo…" : "or photograph what you used"}
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
  const source = SOURCE_STYLE[item.source] ?? SOURCE_STYLE.llm;

  return (
    <div className={`card px-4 py-3.5 ${uncertain ? "border-warn/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <b className="block text-[0.9rem] font-bold text-ink">{item.name}</b>
          <span className={`pill mt-1 ${source.className}`}>{source.label}</span>
          {/* Showing the matched USDA entry is the real defence against a wrong
              match -- USDA has no "poha", so it returns a groundcherry entry that
              shares the word, and only a visible description makes that obvious. */}
          {item.source === "usda" && item.usda_description && (
            <small className="mt-1 block truncate text-[0.7rem] text-ink-dim">
              {item.usda_description}
            </small>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className="shrink-0 rounded-lg p-2 text-ink-dim"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      {uncertain && (
        <p className="mt-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[0.72rem] font-bold text-warn">
          Not sure about this one — worth a check
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={Math.round(item.grams)}
          onChange={(e) => onGrams(Math.max(0, Number(e.target.value) || 0))}
          aria-label={`Grams of ${item.name}`}
          className="field w-20 px-2 py-2 text-center text-sm tabular-nums"
        />
        <span className="text-[0.75rem] font-bold text-ink-dim">grams</span>
        <span className="ml-auto text-[0.95rem] font-extrabold text-ink tabular-nums">
          {round(item.kcal)} kcal
        </span>
      </div>
      <p className="mt-1.5 text-[0.72rem] font-semibold text-ink-dim tabular-nums">
        <span className="text-protein">{round(item.protein_g)}p</span> ·{" "}
        <span className="text-carbs">{round(item.carbs_g)}c</span> ·{" "}
        <span className="text-fat">{round(item.fat_g)}f</span>
      </p>
    </div>
  );
}
