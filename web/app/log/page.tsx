"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, uploadMealPhoto } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";
import ReviewStep from "./ReviewStep";
import type { AnalyzeResult, ResolvedItem, Totals } from "./types";

type Photo = { blob: Blob; previewUrl: string };

export default function LogPage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [caption, setCaption] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [totals, setTotals] = useState<Totals>({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
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

  // Object URLs are a manual resource; without this every added photo leaks.
  useEffect(() => {
    return () => photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPhotos(files: FileList) {
    const added = await Promise.all(
      Array.from(files).map(async (file) => {
        const blob = await downscaleImage(file);
        return { blob, previewUrl: URL.createObjectURL(blob) };
      })
    );
    setPhotos((prev) => [...prev, ...added].slice(0, 5));
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const form = new FormData();
      photos.forEach((photo, i) => form.append("images", photo.blob, `meal-${i}.jpg`));
      if (caption.trim()) form.append("caption", caption.trim());

      const res = await apiFetch("/analyze", { method: "POST", body: form });
      if (res.status === 404) throw new Error("Finish onboarding first so we know your targets.");
      if (!res.ok) throw new Error("We couldn't read that meal. Your photo and note are still here — try again.");

      const data: AnalyzeResult = await res.json();
      setResult(data);
      setItems(data.items);
      setTotals(data.totals);
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
                {photos.length < 5 && (
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

              {error && <p className="mt-3 text-sm font-semibold text-warn">{error}</p>}

              <button
                type="button"
                onClick={analyze}
                disabled={analyzing || (photos.length === 0 && !caption.trim())}
                className="mt-4 w-full bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
              >
                {analyzing ? "Reading your meal..." : "Analyze"}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
