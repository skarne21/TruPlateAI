"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { kgToLb, lbToKg } from "@/lib/units";
import WeightChart from "./WeightChart";
import { localDate, type Target, type WeighInResult, type WeightPoint } from "./types";

export default function WeightPage() {
  const router = useRouter();
  const [points, setPoints] = useState<WeightPoint[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [entry, setEntry] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<WeighInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-profile">("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        router.replace("/login");
        return;
      }
      const [weightsRes, targetRes] = await Promise.all([
        apiFetch("/weights"),
        apiFetch("/targets/current"),
      ]);
      if (cancelled) return;
      if (targetRes.status === 404) {
        setStatus("no-profile");
        return;
      }
      if (weightsRes.ok) setPoints(await weightsRes.json());
      if (targetRes.ok) setTarget(await targetRes.json());
      if (cancelled) return;
      setStatus("ready");
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const toDisplay = (kg: number) => (unit === "lb" ? kgToLb(kg) : kg);

  async function submit() {
    const value = Number(entry);
    if (!value || value <= 0) {
      setError("Enter a weight first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/weights", {
        method: "POST",
        body: JSON.stringify({
          weight_kg: unit === "lb" ? lbToKg(value) : value,
          measured_on: localDate(),
        }),
      });
      if (!res.ok) throw new Error(`Couldn't save that weigh-in (${res.status})`);
      const data: WeighInResult = await res.json();
      setResult(data);
      setTarget(data.target);
      setEntry("");
      const refreshed = await apiFetch("/weights");
      if (refreshed.ok) setPoints(await refreshed.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm text-ink-dim">Loading...</p>
      </main>
    );
  }

  if (status === "no-profile") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="text-center">
          <p className="mb-4 text-sm text-ink-dim">Finish onboarding first.</p>
          <Link
            href="/onboarding"
            className="bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006]"
          >
            Complete onboarding
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest text-accent uppercase">Weigh-in</p>
            <p className="text-sm text-ink-dim">Your targets learn from this.</p>
          </div>
          <Link href="/dashboard" className="text-xs font-bold text-ink-dim underline underline-offset-2">
            Back
          </Link>
        </div>

        <div className="mb-4 border border-border bg-surface p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-dim">Today&apos;s weight</span>
            <button
              type="button"
              onClick={() => setUnit((u) => (u === "lb" ? "kg" : "lb"))}
              className="text-[0.68rem] font-bold text-accent underline underline-offset-2"
            >
              {unit === "lb" ? "kg" : "lb"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder={unit}
              className="flex-1 border border-border bg-surface p-3 text-sm text-ink"
            />
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
            >
              {saving ? "..." : "Save"}
            </button>
          </div>
          {error && <p className="mt-2 text-sm font-semibold text-warn">{error}</p>}
        </div>

        {result && (
          <div
            className={`mb-4 border p-4 ${
              result.adjusted ? "border-accent bg-accent/5" : "border-border bg-surface"
            }`}
          >
            <p className="text-sm font-bold text-ink">
              {result.adjusted ? "Target updated" : "Target unchanged"}
            </p>
            <p className="mt-1 text-sm text-ink-dim">{result.target.explanation}</p>
            {result.observed_tdee !== null && (
              <p className="mt-2 text-xs text-ink-dim tabular-nums">
                Estimated from {result.days_of_data} days of your data — measured burn{" "}
                {Math.round(result.observed_tdee)} kcal/day.
              </p>
            )}
          </div>
        )}

        {target && (
          <div className="mb-4 border border-border bg-surface p-4">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold text-ink tabular-nums">
                {Math.round(target.kcal).toLocaleString()}
              </span>
              <span className="text-sm font-bold text-ink-dim">kcal target</span>
              <span className="ml-auto border border-border px-2 py-0.5 text-[0.68rem] font-bold text-ink-dim">
                {target.source === "adaptive" ? "from your data" : "from the formula"}
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-dim">{target.explanation}</p>
          </div>
        )}

        {points.length >= 2 ? (
          <WeightChart points={points} unit={unit} toDisplay={toDisplay} />
        ) : (
          <p className="border border-border bg-surface p-3.5 text-xs text-ink-dim">
            Weigh in a few times and a trend line appears here. Targets start adapting to your
            own data after 14 days.
          </p>
        )}
      </div>
    </main>
  );
}
