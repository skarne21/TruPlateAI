"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, uploadMealPhoto } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";
import BarcodeScanner from "../components/BarcodeScanner";
import type { BarcodeProduct } from "../foods/types";
import ReviewStep from "./ReviewStep";
import VoiceButton from "./VoiceButton";
import { sumTotals, type AnalyzeResult, type ResolvedItem, type Totals } from "./types";

type Photo = { blob: Blob; previewUrl: string };

// Matches MAX_IMAGES in api/routes/analyze.py.
const MAX_PHOTOS = 5;

// Nutrition labels are stated per 100g, so that is the honest starting
// portion: it is the number actually printed, before anyone estimates.
const DEFAULT_SCAN_GRAMS = 100;

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
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [caption, setCaption] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [totals, setTotals] = useState<Totals>({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const [scanned, setScanned] = useState<ResolvedItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace("/login");
    });
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
        setScanNote("That barcode isn't in the database. Add it in My foods, or just describe it below.");
        return;
      }
      if (!res.ok) throw new Error("Couldn't look that barcode up. Try again.");
      const product: BarcodeProduct = await res.json();
      setScanned((prev) => [...prev, itemFromProduct(product, DEFAULT_SCAN_GRAMS)]);
      setScanning(false);
      setScanNote(`Added ${product.name} — set the weight you actually ate.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't look that barcode up");
    }
  }

  /** Rescale a scanned item, which is exact because label macros are linear. */
  function setScannedGrams(index: number, grams: number) {
    setScanned((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const factor = item.grams > 0 ? grams / item.grams : 0;
        return {
          ...item,
          grams,
          kcal: (item.kcal ?? 0) * factor,
          protein_g: (item.protein_g ?? 0) * factor,
          carbs_g: (item.carbs_g ?? 0) * factor,
          fat_g: (item.fat_g ?? 0) * factor,
        };
      })
    );
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
      if (!res.ok) throw new Error("We couldn't read that meal. Your photo and note are still here — try again.");

      const data: AnalyzeResult = await res.json();
      // Scanned packets are appended rather than sent to be identified --
      // a label beats anything the model could infer about the same food.
      const merged = [...data.items, ...scanned];
      setResult(data);
      setItems(merged);
      setTotals(sumTotals(merged));
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
      const now = new Date();
      const res = await apiFetch("/log", {
        method: "POST",
        body: JSON.stringify({
          items,
          input_mode: result.input_mode,
          // The user's own calendar date -- the server never guesses a timezone.
          logged_on: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
          caption: caption.trim() || null,
          photo_paths: photoPaths,
          analysis_json: result.analysis_json,
        }),
      });
      if (!res.ok) throw new Error(`Couldn't save that meal (${res.status})`);
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that meal");
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-xs font-bold text-ink-dim underline underline-offset-2">
            Back
          </Link>
        </div>

        <div className="border border-border bg-surface p-6">
          {result ? (
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
          ) : (
            <>
              <p className="mb-1 text-xs font-bold tracking-widest text-accent uppercase">
                Log a meal
              </p>
              <h1 className="mb-1 text-xl font-extrabold text-ink">What did you eat?</h1>
              <p className="mb-5 text-sm text-ink-dim">
                A photo, a note, or both. Several photos of the same meal help with portions.
              </p>

              <div className="mb-4 flex flex-wrap gap-2">
                {photos.map((photo, index) => (
                  <div key={photo.previewUrl} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.previewUrl}
                      alt={`Meal photo ${index + 1}`}
                      className="h-20 w-20 border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute -top-2 -right-2 h-6 w-6 border border-border bg-surface text-xs font-extrabold text-ink"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="h-20 w-20 border border-dashed border-border text-xs font-semibold text-ink-dim"
                  >
                    {photos.length ? "+ another" : "+ photo"}
                  </button>
                )}
              </div>

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

              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={3}
                placeholder="Optional — e.g. 2 idlis and sambar, extra ghee"
                className="w-full border border-border bg-surface p-3 text-sm text-ink"
              />

              <div className="mt-2">
                {/* Fills the caption above rather than submitting: the user
                    reads it back before anything is analysed or logged. */}
                <VoiceButton
                  disabled={analyzing}
                  onTranscript={(text) =>
                    setCaption((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
                  }
                />
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-dim">
                    Packaged food? Scan it for exact numbers.
                  </span>
                  <button
                    type="button"
                    onClick={() => setScanning((on) => !on)}
                    className="text-xs font-bold text-accent underline underline-offset-2"
                  >
                    {scanning ? "Close" : "Scan barcode"}
                  </button>
                </div>

                {scanning && <BarcodeScanner onDetected={scanBarcode} busy={analyzing} />}

                {scanNote && <p className="mt-2 text-xs text-ink-dim">{scanNote}</p>}

                {scanned.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    className="mt-2 flex items-center gap-2 border border-border bg-surface p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-xs font-bold text-ink">{item.name}</b>
                      <small className="text-[0.68rem] text-ink-dim tabular-nums">
                        {Math.round(item.kcal ?? 0)} kcal · from the label
                      </small>
                    </div>
                    <input
                      type="number"
                      value={Math.round(item.grams)}
                      onChange={(e) => setScannedGrams(index, Number(e.target.value) || 0)}
                      aria-label={`Grams of ${item.name}`}
                      className="w-20 border border-border bg-surface p-2 text-xs text-ink tabular-nums"
                    />
                    <span className="text-xs text-ink-dim">g</span>
                    <button
                      type="button"
                      onClick={() => setScanned((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remove ${item.name}`}
                      className="px-1 text-sm font-extrabold text-ink-dim"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {error && <p className="mt-3 text-sm font-semibold text-warn">{error}</p>}

              <button
                type="button"
                onClick={analyze}
                disabled={
                  analyzing || (photos.length === 0 && !caption.trim() && scanned.length === 0)
                }
                className="mt-4 w-full bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
              >
                {analyzing
                  ? "Reading your meal..."
                  : photos.length === 0 && !caption.trim()
                    ? "Review scanned items"
                    : "Analyze"}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
