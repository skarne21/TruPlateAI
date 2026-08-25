"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from "@/lib/units";
import ChipGroup from "../onboarding/ChipGroup";
import {
  ACTIVITY_LEVELS,
  CUISINE_OPTIONS,
  EXCLUSION_OPTIONS,
  RATE_OPTIONS,
  type Goal,
  type OnboardingState,
} from "../onboarding/types";

const GOALS: { value: Goal; label: string }[] = [
  { value: "lose", label: "Lose weight" },
  { value: "gain", label: "Gain weight" },
  { value: "recomp", label: "Recomposition" },
];

/** Everything chosen at signup, editable afterwards.
 *
 * Reuses the onboarding option lists and ChipGroup rather than restating them,
 * so the two screens can't drift apart -- an exclusion offered in one place and
 * not the other would be a safety gap, not a cosmetic one.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [heightUnit, setHeightUnit] = useState<"ftin" | "cm">("ftin");
  const [weightUnit, setWeightUnit] = useState<"lb" | "kg">("lb");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const res = await apiFetch("/profile/settings");
      if (cancelled) return;
      if (res.status === 404) {
        router.replace("/onboarding");
        return;
      }
      if (res.ok) setState(await res.json());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function update<K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) {
    setState((prev) => (prev ? { ...prev, [key]: value } : prev));
    setNote(null);
  }

  async function save() {
    if (!state) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/profile", { method: "POST", body: JSON.stringify(state) });
      if (!res.ok) throw new Error(`Couldn't save that (${res.status})`);
      const targets = await res.json();
      setNote(
        `Saved. Your formula target is now ${Math.round(targets.kcal_target).toLocaleString()} kcal ` +
          `and ${Math.round(targets.protein_g)}g protein.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm text-ink-dim">Loading...</p>
      </main>
    );
  }

  const ftIn = cmToFtIn(state.height_cm);
  const rates = RATE_OPTIONS[state.goal];

  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest text-accent uppercase">Settings</p>
            <p className="text-sm text-ink-dim">Change anything you picked at signup.</p>
          </div>
          <Link href="/dashboard" className="text-xs font-bold text-ink-dim underline underline-offset-2">
            Back
          </Link>
        </div>

        <div className="mb-4 border border-border bg-surface p-4">
          <p className="mb-2 text-xs font-semibold text-ink-dim">Goal</p>
          <div className="mb-4 flex gap-2">
            {GOALS.map((goal) => (
              <button
                key={goal.value}
                type="button"
                onClick={() => {
                  update("goal", goal.value);
                  update("rate_lb_per_week", RATE_OPTIONS[goal.value][0]);
                }}
                className={`flex-1 border px-2 py-2.5 text-xs font-bold ${
                  state.goal === goal.value
                    ? "border-accent bg-accent text-[#1a1006]"
                    : "border-border bg-surface text-ink"
                }`}
              >
                {goal.label}
              </button>
            ))}
          </div>

          <p className="mb-2 text-xs font-semibold text-ink-dim">Pace (lb/week)</p>
          <div className="flex gap-2">
            {rates.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => update("rate_lb_per_week", rate)}
                className={`flex-1 border py-2.5 text-sm font-bold tabular-nums ${
                  state.rate_lb_per_week === rate
                    ? "border-accent bg-accent text-[#1a1006]"
                    : "border-border bg-surface text-ink"
                }`}
              >
                {rate === 0 ? "maintain" : rate}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 border border-border bg-surface p-4">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-dim">Height</span>
                <button
                  type="button"
                  onClick={() => setHeightUnit((u) => (u === "ftin" ? "cm" : "ftin"))}
                  className="text-[0.68rem] font-bold text-accent underline underline-offset-2"
                >
                  {heightUnit === "ftin" ? "cm" : "ft/in"}
                </button>
              </div>
              {heightUnit === "ftin" ? (
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={ftIn.ft}
                    onChange={(e) => update("height_cm", ftInToCm(Number(e.target.value) || 0, ftIn.inch))}
                    className="w-full border border-border bg-surface p-2.5 text-sm text-ink"
                  />
                  <input
                    type="number"
                    step={0.5}
                    value={ftIn.inch}
                    onChange={(e) => update("height_cm", ftInToCm(ftIn.ft, Number(e.target.value) || 0))}
                    className="w-full border border-border bg-surface p-2.5 text-sm text-ink"
                  />
                </div>
              ) : (
                <input
                  type="number"
                  value={Math.round(state.height_cm)}
                  onChange={(e) => update("height_cm", Number(e.target.value) || 0)}
                  className="w-full border border-border bg-surface p-2.5 text-sm text-ink"
                />
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-dim">Weight</span>
                <button
                  type="button"
                  onClick={() => setWeightUnit((u) => (u === "lb" ? "kg" : "lb"))}
                  className="text-[0.68rem] font-bold text-accent underline underline-offset-2"
                >
                  {weightUnit === "lb" ? "kg" : "lb"}
                </button>
              </div>
              <input
                type="number"
                value={weightUnit === "lb" ? Math.round(kgToLb(state.weight_kg)) : Math.round(state.weight_kg)}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  update("weight_kg", weightUnit === "lb" ? lbToKg(v) : v);
                }}
                className="w-full border border-border bg-surface p-2.5 text-sm text-ink"
              />
            </div>
          </div>

          <p className="mb-1.5 text-xs font-semibold text-ink-dim">Non-training activity</p>
          <div className="flex flex-col gap-2">
            {ACTIVITY_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => update("activity_level", level.value)}
                className={`border p-2.5 text-left ${
                  state.activity_level === level.value
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface"
                }`}
              >
                <b className="block text-sm font-bold text-ink">{level.label}</b>
                <small className="text-xs text-ink-dim">{level.desc}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 border border-border bg-surface p-4">
          <p className="mb-1.5 text-xs font-semibold text-ink-dim">Cuisines you eat</p>
          <div className="mb-4">
            <ChipGroup
              options={CUISINE_OPTIONS}
              selected={state.cuisines}
              onChange={(next) => update("cuisines", next)}
              customPlaceholder="Type a cuisine..."
            />
          </div>

          <p className="mb-1.5 text-xs font-semibold text-ink-dim">Exclusions &amp; allergies</p>
          <ChipGroup
            options={EXCLUSION_OPTIONS}
            selected={state.exclusions}
            onChange={(next) => update("exclusions", next)}
            customPlaceholder="Type an allergy or exclusion..."
          />
          <p className="mt-2 text-xs text-ink-dim">
            Recipe suggestions are filtered against this list in code, not by the AI.
          </p>
        </div>

        {note && (
          <p className="mb-3 border border-good/40 bg-good/10 p-3 text-xs font-semibold text-ink">
            {note}
          </p>
        )}
        {error && <p className="mb-3 text-sm font-semibold text-warn">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mb-3 w-full bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>

        <button
          type="button"
          onClick={logout}
          className="w-full border border-border px-4 py-3 text-sm font-bold text-ink-dim"
        >
          Log out
        </button>
      </div>
    </main>
  );
}
