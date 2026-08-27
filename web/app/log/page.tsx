"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, requireSession, uploadMealPhoto } from "@/lib/api";
import { localDate } from "@/lib/day";
import { downscaleImage } from "@/lib/image";
import BarcodeScanner from "../components/BarcodeScanner";
import type { BarcodeProduct } from "../foods/types";
import {
  BarcodeIcon,
  CameraIcon,
  CloseIcon,
  ImageIcon,
  PencilIcon,
} from "../components/icons";
import { Confetti, CountUp, LoadingScreen, Notice, Screen, TopBar, haptic } from "../components/ui";
import ReviewStep from "./ReviewStep";
import VoiceButton from "./VoiceButton";
import { scaleItem, sumTotals, type AnalyzeResult, type ResolvedItem, type Totals } from "./types";

type Photo = { blob: Blob; previewUrl: string };
type Mode = "photo" | "describe" | "scan";

// Matches MAX_IMAGES in api/routes/analyze.py.
const MAX_PHOTOS = 5;

// Nutrition labels are stated per 100g, so that is the honest starting
// portion: it is the number actually printed, before anyone estimates.
const DEFAULT_SCAN_GRAMS = 100;

const MODES: { key: Mode; label: string; Icon: (p: { className?: string }) => React.ReactElement }[] = [
  { key: "photo", label: "Photo", Icon: CameraIcon },
  { key: "describe", label: "Describe", Icon: PencilIcon },
  { key: "scan", label: "Scan", Icon: BarcodeIcon },
];

/** Turn a scanned product into a meal item at the given weight.
 *
 * Confidence is 1: these macros are printed on the packet rather than
 * identified from a photo, so there is nothing to be unsure about except
 * the weight, which the user sets.
 */
function itemFromProduct(product: BarcodeProduct, grams: number): ResolvedItem {
  const factor = grams / 100;
  // Open Food Facts often repeats the brand inside the product name, so
  // concatenating blindly gives "Coca-Cola Coca-Cola".
  const brand = product.brand?.trim();
  const label =
    brand && !product.name.toLowerCase().includes(brand.toLowerCase())
      ? `${brand} ${product.name}`
      : product.name;
  return {
    name: label,
    usda_query: product.name,
    grams,
    count: 1,
    unit: "g",
    confidence: 1,
    source: "barcode",
    usda_fdc_id: null,
    usda_description: label,
    kcal: product.kcal_per_100g * factor,
    protein_g: product.protein_per_100g * factor,
    carbs_g: product.carbs_per_100g * factor,
    fat_g: product.fat_per_100g * factor,
  };
}

export default function LogPage() {
  // useSearchParams needs a suspense boundary during prerender; the deep links
  // from the dashboard's quick actions are what it reads.
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LogScreen />
    </Suspense>
  );
}

function LogScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    (["photo", "describe", "scan"] as const).find((m) => m === params.get("mode")) ?? "photo"
  );
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [caption, setCaption] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [totals, setTotals] = useState<Totals>({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const [scanned, setScanned] = useState<ResolvedItem[]>([]);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logged, setLogged] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requireSession(router).catch(() => setError("Can't reach the server. Your draft is safe."));
  }, [router]);

  // Object URLs are a manual resource. A cleanup with an empty dependency list
  // would close over the FIRST render's empty photo array and revoke nothing,
  // so the latest list is tracked in a ref and read at unmount instead.
  const photosRef = useRef<Photo[]>([]);
  useEffect(() => {
    photosRef.current = photos; // no dependency list: sync after every render
  });
  useEffect(() => {
    return () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  }, []);

  async function addPhotos(files: FileList) {
    // Only process what will actually fit -- creating object URLs first and
    // slicing the overflow away afterwards leaks every discarded one.
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const added = await Promise.all(
      Array.from(files)
        .slice(0, room)
        .map(async (file) => {
          const blob = await downscaleImage(file);
          return { blob, previewUrl: URL.createObjectURL(blob) };
        })
    );
    setPhotos((prev) => [...prev, ...added]);
    haptic();
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function scanBarcode(code: string) {
    setError(null);
    setScanNote(null);
    try {
      const res = await apiFetch(`/barcode/${encodeURIComponent(code)}`);
      if (res.status === 404) {
        // Not worth blocking the meal over: describe it in the note instead
        // and the normal pipeline still gets a shot at it.
        setScanNote(
          "That barcode isn't in the database. Add it under My foods, or just describe it."
        );
        return;
      }
      if (!res.ok) throw new Error("Couldn't look that barcode up. Try again.");
      const product: BarcodeProduct = await res.json();
      setScanned((prev) => [...prev, itemFromProduct(product, DEFAULT_SCAN_GRAMS)]);
      setScanNote(`Added ${product.name} — set the weight you actually ate.`);
      haptic([10, 40, 10]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't look that barcode up");
    }
  }

  /** Rescale a scanned item, which is exact because label macros are linear. */
  function setScannedGrams(index: number, grams: number) {
    setScanned((prev) => prev.map((item, i) => (i === index ? scaleItem(item, grams) : item)));
  }

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      // Nothing but scanned packets: the numbers are already exact, so
      // there is nothing for the model to identify. Skipping the call saves
      // a few seconds and an API charge on the one input that needs neither.
      if (photos.length === 0 && !caption.trim()) {
        setResult({
          meal_summary: scanned.map((i) => i.name).join(", "),
          input_mode: "barcode",
          items: scanned,
          questions: [],
          totals: sumTotals(scanned),
          warnings: [],
          analysis_json: { source: "barcode", items: scanned.map((i) => i.name) },
          similar_meal: null,
        });
        setItems(scanned);
        setTotals(sumTotals(scanned));
        return;
      }

      const form = new FormData();
      photos.forEach((photo, i) => form.append("images", photo.blob, `meal-${i}.jpg`));
      if (caption.trim()) form.append("caption", caption.trim());

      const res = await apiFetch("/analyze", { method: "POST", body: form });
      if (res.status === 404) throw new Error("Finish onboarding first so we know your targets.");
      if (!res.ok)
        throw new Error(
          "We couldn't read that meal. Your photo and note are still here — try again."
        );

      const data: AnalyzeResult = await res.json();
      // Scanned packets are appended rather than sent to be identified --
      // a label beats anything the model could infer about the same food.
      const merged = [...data.items, ...scanned];
      setResult(data);
      setItems(merged);
      setTotals(sumTotals(merged));
      haptic();
    } catch (e) {
      // The draft is deliberately left intact: a failed analysis must never
      // silently drop a meal.
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAnalyzing(false);
    }
  }

  async function confirm() {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const photoPaths = await Promise.all(photos.map((photo) => uploadMealPhoto(photo.blob)));
      const res = await apiFetch("/log", {
        method: "POST",
        body: JSON.stringify({
          items,
          input_mode: result.input_mode,
          // The user's own calendar date -- the server never guesses a timezone.
          logged_on: localDate(),
          caption: caption.trim() || null,
          photo_paths: photoPaths,
          analysis_json: result.analysis_json,
        }),
      });
      if (!res.ok) throw new Error(`Couldn't save that meal (${res.status})`);
      haptic([14, 50, 14, 50, 22]);
      setLogged(totals);
      // Long enough for the confetti to land and the number to finish counting.
      setTimeout(() => router.push("/dashboard"), 1900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that meal");
      setSaving(false);
    }
  }

  if (logged) return <LoggedScreen totals={logged} />;

  if (result) {
    return (
      <Screen tabs={false}>
        <TopBar
          title="Check it over"
          subtitle="Nothing is saved until you tap log"
          back="/dashboard"
        />
        <ReviewStep
          result={result}
          items={items}
          totals={totals}
          saving={saving}
          onChange={(nextItems, nextTotals) => {
            setItems(nextItems);
            setTotals(nextTotals);
          }}
          onConfirm={confirm}
        />
        {error && (
          <div className="mt-3">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}
      </Screen>
    );
  }

  const attached =
    photos.length + scanned.length + (caption.trim() ? 1 : 0) > 0
      ? [
          photos.length && `${photos.length} photo${photos.length > 1 ? "s" : ""}`,
          scanned.length && `${scanned.length} scanned`,
          caption.trim() && "a note",
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  const nothingToSend = photos.length === 0 && !caption.trim() && scanned.length === 0;

  return (
    <Screen tabs={false} className="pb-32">
      <TopBar title="Log a meal" subtitle="Photo, words, barcode — or all three" back="/dashboard" />

      {/* One segmented control instead of three stacked sections. Whatever you
          attach in one tab stays attached in the others, and the strip above
          the button says what's coming with you. */}
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1">
        {MODES.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            aria-pressed={mode === key}
            className={`flex items-center justify-center gap-1.5 rounded-full py-2.5 text-[0.8rem] font-extrabold transition-colors ${
              mode === key ? "bg-surface text-ink shadow-sm" : "text-ink-dim"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "photo" && (
        <section className="rise">
          {photos.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-strong bg-surface-2 px-6 py-12 text-center transition-transform active:scale-[0.98]"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br from-accent to-accent-2 text-on-accent">
                <CameraIcon className="h-7 w-7" />
              </span>
              <b className="text-[0.95rem] font-extrabold text-ink">Take a photo</b>
              <span className="max-w-[16rem] text-[0.78rem] text-ink-dim">
                Get the whole plate in frame. A second angle helps us judge the portion.
              </span>
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo, index) => (
                <div key={photo.previewUrl} className="pop relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt={`Meal photo ${index + 1}`}
                    className="h-full w-full rounded-xl border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    aria-label={`Remove photo ${index + 1}`}
                    className="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-ink shadow-md"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border-strong text-ink-dim"
                >
                  <ImageIcon className="h-5 w-5" />
                  <span className="text-[0.7rem] font-bold">Add</span>
                </button>
              )}
            </div>
          )}

          <label className="mt-4 mb-1.5 block text-[0.75rem] font-bold text-ink-dim">
            Anything the camera can&apos;t see? (optional)
          </label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            placeholder="e.g. cooked in a tablespoon of ghee"
            className="field resize-none"
          />
        </section>
      )}

      {mode === "describe" && (
        <section className="rise">
          <textarea
            autoFocus
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            placeholder="2 idlis with sambar and coconut chutney, plus a filter coffee"
            className="field resize-none text-[0.95rem]"
          />
          <p className="mt-2 mb-4 text-[0.75rem] text-ink-dim">
            Portions help — &ldquo;a cup of&rdquo;, &ldquo;two rotis&rdquo;, &ldquo;half a
            plate&rdquo;.
          </p>
          {/* Fills the box above rather than submitting: the user reads it back
              before anything is analysed or logged. */}
          <VoiceButton
            disabled={analyzing}
            onTranscript={(text) =>
              setCaption((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
            }
          />
        </section>
      )}

      {mode === "scan" && (
        <section className="rise">
          <BarcodeScanner onDetected={scanBarcode} busy={analyzing} />

          {scanNote && (
            <div className="mt-3">
              <Notice tone="good">{scanNote}</Notice>
            </div>
          )}

          {scanned.map((item, index) => (
            <div key={`${item.name}-${index}`} className="card pop mt-2 flex items-center gap-2 px-3 py-3">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[0.8rem] font-bold text-ink">{item.name}</b>
                <span className="pill mt-0.5 bg-good/12 text-good">
                  {Math.round(item.kcal ?? 0)} kcal · from the label
                </span>
              </div>
              <input
                type="number"
                value={Math.round(item.grams)}
                onChange={(e) => setScannedGrams(index, Number(e.target.value) || 0)}
                aria-label={`Grams of ${item.name}`}
                className="field w-20 px-2 py-2 text-center text-sm tabular-nums"
              />
              <span className="text-xs font-bold text-ink-dim">g</span>
              <button
                type="button"
                onClick={() => setScanned((prev) => prev.filter((_, i) => i !== index))}
                aria-label={`Remove ${item.name}`}
                className="shrink-0 text-ink-dim"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </section>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addPhotos(e.target.files);
          e.target.value = "";
        }}
      />

      {error && (
        <div className="mt-4">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      {/* The commit button lives in thumb reach and never scrolls away. */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/90 px-4 pt-3 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md">
          {attached && (
            <p className="mb-2 text-center text-[0.7rem] font-semibold text-ink-dim">
              Sending {attached}
            </p>
          )}
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing || nothingToSend}
            className="btn btn-primary w-full"
          >
            {analyzing
              ? "Reading your meal…"
              : photos.length === 0 && !caption.trim()
                ? "Review scanned items"
                : "Analyze meal"}
          </button>
        </div>
      </div>
    </Screen>
  );
}

/** The payoff. Everything about this screen exists to make finishing a log
 *  feel like something, because the habit is the whole product. */
function LoggedScreen({ totals }: { totals: Totals }) {
  return (
    <Screen tabs={false}>
      <Confetti />
      <div className="flex min-h-screen flex-col items-center justify-center text-center">
        <div className="pop mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-linear-to-br from-accent to-accent-2 text-5xl shadow-pop">
          🎉
        </div>
        <h1 className="mb-1 text-2xl font-extrabold text-ink">Logged</h1>
        <p className="mb-6 text-sm text-ink-dim">Grounded in real numbers, not a guess.</p>

        <div className="card card-lift w-full px-6 py-6">
          <p className="text-5xl leading-none font-extrabold tracking-tight text-ink">
            <CountUp value={Math.round(totals.kcal)} />
            <span className="text-base font-bold text-ink-dim"> kcal</span>
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Protein", value: totals.protein_g, color: "text-protein" },
              { label: "Carbs", value: totals.carbs_g, color: "text-carbs" },
              { label: "Fat", value: totals.fat_g, color: "text-fat" },
            ].map((m) => (
              <div key={m.label}>
                <p className={`text-lg font-extrabold tabular-nums ${m.color}`}>
                  {Math.round(m.value)}g
                </p>
                <p className="text-[0.7rem] font-bold text-ink-dim">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}
