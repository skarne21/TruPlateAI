"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, requireSession } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from "@/lib/units";
import { LogoutIcon } from "../components/icons";
import { LoadFailed, LoadingScreen, Notice, Screen, TopBar, haptic } from "../components/ui";
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
  { value: "lose", label: "Lose" },
  { value: "gain", label: "Gain" },
  { value: "recomp", label: "Recomp" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card rise mb-3 px-4 py-4">
      <h2 className="mb-3 text-[0.8rem] font-extrabold text-ink">{title}</h2>
      {children}
    </section>
  );
}

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const session = await requireSession(router);
      if (cancelled || !session) return;
      const res = await apiFetch("/profile/settings");
      if (cancelled) return;
      if (res.status === 404) {
        router.replace("/onboarding");
        return;
      }
      if (res.ok) setState(await res.json());
    }
    load().catch(() => setFailed(true));
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
      haptic();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  if (failed) return <LoadFailed what="your settings" />;
  if (!state) return <LoadingScreen />;

  const ftIn = cmToFtIn(state.height_cm);
  const rates = RATE_OPTIONS[state.goal];

  return (
    <Screen>
      <TopBar title="Settings" subtitle="Anything you picked at signup" back="/you" />

      <Section title="Goal">
        <div className="mb-4 grid grid-cols-3 gap-2">
          {GOALS.map((goal) => (
            <button
              key={goal.value}
              type="button"
              data-on={state.goal === goal.value}
              onClick={() => {
                update("goal", goal.value);
                update("rate_lb_per_week", RATE_OPTIONS[goal.value][0]);
              }}
              className="choice py-3 text-[0.82rem] font-extrabold text-ink"
            >
              {goal.label}
            </button>
          ))}
        </div>

        <p className="mb-2 text-[0.72rem] font-bold text-ink-dim">Pace (lb per week)</p>
        <div className="flex gap-2">
          {rates.map((rate) => (
            <button
              key={rate}
              type="button"
              data-on={state.rate_lb_per_week === rate}
              onClick={() => update("rate_lb_per_week", rate)}
              className="choice flex-1 py-3 text-[0.85rem] font-extrabold text-ink tabular-nums"
            >
              {rate === 0 ? "maintain" : rate}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Body">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[0.72rem] font-bold text-ink-dim">Height</span>
              <button
                type="button"
                onClick={() => setHeightUnit((u) => (u === "ftin" ? "cm" : "ftin"))}
                className="text-[0.68rem] font-extrabold text-accent"
              >
                {heightUnit === "ftin" ? "use cm" : "use ft/in"}
              </button>
            </div>
            {heightUnit === "ftin" ? (
              <div className="flex gap-2">
                <input
                  type="number"
                  aria-label="Height, feet"
                  value={ftIn.ft}
                  onChange={(e) =>
                    update("height_cm", ftInToCm(Number(e.target.value) || 0, ftIn.inch))
                  }
                  className="field py-2.5 text-center text-sm tabular-nums"
                />
                <input
                  type="number"
                  step={0.5}
                  aria-label="Height, inches"
                  value={ftIn.inch}
                  onChange={(e) =>
                    update("height_cm", ftInToCm(ftIn.ft, Number(e.target.value) || 0))
                  }
                  className="field py-2.5 text-center text-sm tabular-nums"
                />
              </div>
            ) : (
              <input
                type="number"
                aria-label="Height in centimetres"
                value={Math.round(state.height_cm)}
                onChange={(e) => update("height_cm", Number(e.target.value) || 0)}
                className="field py-2.5 text-center text-sm tabular-nums"
              />
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[0.72rem] font-bold text-ink-dim">Weight</span>
              <button
                type="button"
                onClick={() => setWeightUnit((u) => (u === "lb" ? "kg" : "lb"))}
                className="text-[0.68rem] font-extrabold text-accent"
              >
                {weightUnit === "lb" ? "use kg" : "use lb"}
              </button>
            </div>
            <input
              type="number"
              aria-label={`Weight in ${weightUnit}`}
              value={
                weightUnit === "lb" ? Math.round(kgToLb(state.weight_kg)) : Math.round(state.weight_kg)
              }
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                update("weight_kg", weightUnit === "lb" ? lbToKg(v) : v);
              }}
              className="field py-2.5 text-center text-sm tabular-nums"
            />
          </div>
        </div>

        <p className="mb-2 text-[0.72rem] font-bold text-ink-dim">Non-training activity</p>
        <div className="flex flex-col gap-2">
          {ACTIVITY_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              data-on={state.activity_level === level.value}
              onClick={() => update("activity_level", level.value)}
              className="choice px-3.5 py-3 text-left"
            >
              <b className="block text-[0.85rem] font-bold text-ink">{level.label}</b>
              <small className="text-[0.72rem] text-ink-dim">{level.desc}</small>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Food">
        <p className="mb-2 text-[0.72rem] font-bold text-ink-dim">Cuisines you eat</p>
        <div className="mb-4">
          <ChipGroup
            options={CUISINE_OPTIONS}
            selected={state.cuisines}
            onChange={(next) => update("cuisines", next)}
            customPlaceholder="Type a cuisine…"
          />
        </div>

        <p className="mb-2 text-[0.72rem] font-bold text-ink-dim">Exclusions &amp; allergies</p>
        <ChipGroup
          options={EXCLUSION_OPTIONS}
          selected={state.exclusions}
          onChange={(next) => update("exclusions", next)}
          customPlaceholder="Type an allergy or exclusion…"
        />
        <p className="mt-2.5 text-[0.72rem] text-ink-dim">
          Recipe suggestions are filtered against this list in code, not by the AI.
        </p>
      </Section>

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

      <button type="button" onClick={save} disabled={saving} className="btn btn-primary mb-2.5 w-full">
        {saving ? "Saving…" : "Save changes"}
      </button>

      <button type="button" onClick={logout} className="btn btn-quiet w-full">
        <LogoutIcon className="h-4 w-4" />
        Log out
      </button>
    </Screen>
  );
}
