"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, requireSession } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import BarcodeScanner from "../components/BarcodeScanner";
import { CameraIcon, PlusIcon, TrashIcon } from "../components/icons";
import { LoadFailed, LoadingScreen, Notice, Screen, TopBar, haptic } from "../components/ui";
import { draftFromProduct, emptyDraft, type Draft, type SavedFood } from "./types";

export default function FoodsPage() {
  const router = useRouter();
  const [foods, setFoods] = useState<SavedFood[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const labelInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const session = await requireSession(router);
      if (cancelled || !session) return;
      const res = await apiFetch("/foods");
      if (cancelled) return;
      setFoods(res.ok ? await res.json() : []);
    }
    load().catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function scan(code: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await apiFetch(`/barcode/${encodeURIComponent(code)}`);
      if (res.status === 404) {
        // Not a failure worth blocking on -- the form is right there.
        setDraft({ ...emptyDraft, barcode: code });
        setShowForm(true);
        setNote("That barcode isn't in the database. Fill in the numbers from the label.");
        return;
      }
      if (!res.ok) throw new Error("Couldn't look that up. Try again, or add it by hand.");
      setDraft(draftFromProduct(await res.json()));
      setShowForm(true);
      setNote("Found it — check the numbers against the label before saving.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function readLabel(file: File) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const form = new FormData();
      form.append("image", await downscaleImage(file), "label.jpg");
      const res = await apiFetch("/foods/label", { method: "POST", body: form });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail || "Couldn't read that label. Try a clearer photo.");
      }
      const read = await res.json();
      setDraft((prev) => ({
        ...prev,
        name: read.product_name || prev.name,
        kcal_per_100g: String(Math.round(read.kcal_per_100g)),
        protein_per_100g: String(Math.round(read.protein_per_100g * 10) / 10),
        carbs_per_100g: String(Math.round(read.carbs_per_100g * 10) / 10),
        fat_per_100g: String(Math.round(read.fat_per_100g * 10) / 10),
      }));
      setShowForm(true);
      setNote(
        read.basis === "per_serving"
          ? `Read from a per-serving panel (${Math.round(read.serving_grams ?? 0)}g) and converted to per 100g. Check it against the packet.`
          : "Read from the label. Check it against the packet before saving."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that label");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const kcal = Number(draft.kcal_per_100g);
    if (!draft.name.trim()) return setError("Give it a name.");
    if (!Number.isFinite(kcal) || kcal < 0) return setError("Calories per 100g is required.");

    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/foods", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          brand: draft.brand.trim() || null,
          barcode: draft.barcode.trim() || null,
          kcal_per_100g: kcal,
          protein_per_100g: Number(draft.protein_per_100g) || 0,
          carbs_per_100g: Number(draft.carbs_per_100g) || 0,
          fat_per_100g: Number(draft.fat_per_100g) || 0,
          serving_grams: Number(draft.serving_grams) || 100,
          source: draft.barcode.trim() ? "barcode" : "manual",
        }),
      });
      if (!res.ok) throw new Error(`Couldn't save that (${res.status})`);
      const saved: SavedFood = await res.json();
      setFoods((prev) =>
        [...(prev ?? []).filter((f) => f.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      setDraft(emptyDraft);
      setShowForm(false);
      setNote(`Saved. ${saved.name} will now use your numbers instead of the database's.`);
      haptic([10, 40, 10]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setFoods((prev) => (prev ?? []).filter((f) => f.id !== id));
    await apiFetch(`/foods/${id}`, { method: "DELETE" }).catch(() => {});
  }

  const field = (key: keyof Draft, label: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label className="mb-1.5 block text-[0.72rem] font-bold text-ink-dim">{label}</label>
      <input
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        className="field py-2.5 text-sm"
        {...extra}
      />
    </div>
  );

  if (failed) return <LoadFailed what="your foods" />;
  if (!foods) return <LoadingScreen />;

  return (
    <Screen>
      <TopBar
        title="My foods"
        subtitle="Saved here, used instead of the database"
        back="/you"
      />

      {/* The naming trick is invisible unless someone says it out loud, and
          it is the reason saving a food is worth the thirty seconds. */}
      <div className="mb-4">
        <Notice tone="good">
          Once a food is saved you can just say <b>&ldquo;my protein powder&rdquo;</b> when
          logging — we&apos;ll match it to the exact brand you saved and use your numbers.
        </Notice>
      </div>

      <div className="mb-4">
        <BarcodeScanner onDetected={scan} busy={busy} />
      </div>

      {note && (
        <div className="mb-3">
          <Notice tone="good">{note}</Notice>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      {showForm ? (
        <div className="card rise mb-4 px-4 py-4">
          <div className="mb-3 grid grid-cols-2 gap-3">
            {field("name", "Name")}
            {field("brand", "Brand (optional)")}
          </div>

          <p className="mb-1.5 text-[0.72rem] font-bold text-ink-dim">Per 100g</p>
          <div className="mb-3 grid grid-cols-4 gap-2">
            {field("kcal_per_100g", "kcal", { type: "number", inputMode: "decimal" })}
            {field("protein_per_100g", "protein", { type: "number", inputMode: "decimal" })}
            {field("carbs_per_100g", "carbs", { type: "number", inputMode: "decimal" })}
            {field("fat_per_100g", "fat", { type: "number", inputMode: "decimal" })}
          </div>

          {field("serving_grams", "Your usual serving (grams)", {
            type: "number",
            inputMode: "decimal",
          })}

          <button
            type="button"
            disabled={busy}
            onClick={() => labelInput.current?.click()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong py-3 text-[0.82rem] font-bold text-ink-dim disabled:opacity-40"
          >
            <CameraIcon className="h-4 w-4" />
            {busy ? "Reading label…" : "Photograph the nutrition label instead"}
          </button>
          <input
            ref={labelInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readLabel(file);
              e.target.value = "";
            }}
          />

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="btn btn-primary flex-1"
            >
              {busy ? "Saving…" : "Save food"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setDraft(emptyDraft);
              }}
              className="btn btn-ghost px-5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong py-3.5 text-[0.85rem] font-bold text-ink-dim transition-transform active:scale-[0.98]"
        >
          <PlusIcon className="h-4 w-4" />
          Add a food by hand
        </button>
      )}

      {foods.length === 0 ? (
        <div className="card px-5 py-6 text-center">
          <span className="mb-2 block text-3xl">🥣</span>
          <p className="text-[0.8rem] text-ink-dim">
            Nothing saved yet. This is where to fix foods the database gets wrong — USDA has no
            entry for poha, for instance, so it matches a berry that shares the name. Save it
            once here and it&apos;s right from then on.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {foods.map((food) => (
            <div key={food.id} className="card px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <b className="block text-[0.88rem] font-bold text-ink">{food.name}</b>
                  <small className="block text-[0.72rem] text-ink-dim">
                    {food.brand ? `${food.brand} · ` : ""}
                    {Math.round(food.kcal_per_100g)} kcal / 100g · serving{" "}
                    {Math.round(food.serving_grams)}g
                    {food.barcode ? " · scanned" : ""}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => remove(food.id)}
                  aria-label={`Remove ${food.name}`}
                  className="shrink-0 rounded-lg p-2 text-ink-dim"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[0.72rem] font-semibold text-ink-dim tabular-nums">
                <span className="text-protein">{Math.round(food.protein_per_100g)}p</span> ·{" "}
                <span className="text-carbs">{Math.round(food.carbs_per_100g)}c</span> ·{" "}
                <span className="text-fat">{Math.round(food.fat_per_100g)}f</span> per 100g
              </p>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
