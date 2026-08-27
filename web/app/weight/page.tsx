"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, requireSession } from "@/lib/api";
import { localDate } from "@/lib/day";
import { kgToLb, lbToKg } from "@/lib/units";
import { ScaleIcon, SparkIcon } from "../components/icons";
import {
  Confetti,
  CountUp,
  LoadFailed,
  LoadingScreen,
  NeedsOnboarding,
  Notice,
  Screen,
  TopBar,
  haptic,
} from "../components/ui";
import WeightChart from "./WeightChart";
import type { Target, WeighInResult, WeightPoint } from "./types";

export default function WeightPage() {
  const router = useRouter();
  const [points, setPoints] = useState<WeightPoint[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [entry, setEntry] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<WeighInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-profile" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const session = await requireSession(router);
      if (cancelled || !session) return;

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
    load().catch(() => setStatus("failed"));
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
      haptic(data.adjusted ? [12, 40, 12, 40, 20] : 12);
      const refreshed = await apiFetch("/weights");
      if (refreshed.ok) setPoints(await refreshed.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") return <LoadingScreen />;
  if (status === "no-profile") return <NeedsOnboarding />;
  if (status === "failed") return <LoadFailed what="your weigh-ins" />;

  return (
    <Screen>
      {/* A recalculated target is the app proving it learns. That deserves the
          confetti more than a routine weigh-in does. */}
      {result?.adjusted && <Confetti pieces={22} />}

      <TopBar title="Weigh-in" subtitle="Your targets learn from this" back="/you" />

      <section className="card card-lift rise mb-3 px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScaleIcon className="h-5 w-5 text-accent" />
            <span className="text-[0.85rem] font-extrabold text-ink">Today&apos;s weight</span>
          </div>
          <div className="flex gap-0.5 rounded-full bg-surface-2 p-0.5">
            {(["lb", "kg"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                className={`rounded-full px-3 py-1 text-[0.72rem] font-extrabold ${
                  unit === u ? "bg-surface text-ink shadow-sm" : "text-ink-dim"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder={`0.0 ${unit}`}
            aria-label={`Weight in ${unit}`}
            className="field flex-1 py-3.5 text-center text-2xl font-extrabold tabular-nums"
          />
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="btn btn-primary shrink-0 px-6"
          >
            {saving ? "…" : "Save"}
          </button>
        </div>

        {error && (
          <div className="mt-3">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}
      </section>

      {result && (
        <div
          className={`card pop mb-3 px-4 py-4 ${result.adjusted ? "border-good/45 bg-good/8" : ""}`}
        >
          <div className="flex items-center gap-2">
            {result.adjusted && <SparkIcon className="h-5 w-5 shrink-0 text-good" />}
            <b className="text-[0.9rem] font-extrabold text-ink">
              {result.adjusted ? "Target updated" : "Target unchanged"}
            </b>
          </div>
          <p className="mt-1.5 text-[0.82rem] text-ink-2">{result.target.explanation}</p>
          {result.observed_tdee !== null && (
            <p className="mt-2 text-[0.72rem] text-ink-dim tabular-nums">
              Measured from {result.days_of_data} days of your own data — you burn about{" "}
              {Math.round(result.observed_tdee)} kcal/day.
            </p>
          )}
        </div>
      )}

      {target && (
        <section className="card rise mb-3 px-5 py-5">
          <div className="flex items-baseline gap-2">
            <p className="text-3xl leading-none font-extrabold tracking-tight text-ink">
              <CountUp value={Math.round(target.kcal)} />
            </p>
            <span className="text-[0.8rem] font-bold text-ink-dim">kcal target</span>
            <span
              className={`pill ml-auto ${
                target.source === "adaptive"
                  ? "bg-good/12 text-good"
                  : "bg-surface-2 text-ink-dim"
              }`}
            >
              {target.source === "adaptive" ? "from your data" : "from the formula"}
            </span>
          </div>
          <p className="mt-2.5 text-[0.82rem] text-ink-2">{target.explanation}</p>
        </section>
      )}

      {points.length >= 2 ? (
        <div className="rise">
          <WeightChart points={points} unit={unit} toDisplay={toDisplay} />
        </div>
      ) : (
        <Notice>
          Weigh in a few times and a trend line appears here. Targets start adapting to your own
          data after 14 days.
        </Notice>
      )}
    </Screen>
  );
}
