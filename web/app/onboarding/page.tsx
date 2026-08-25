"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from "@/lib/units";
import ChipGroup from "./ChipGroup";
import {
  ACTIVITY_LEVELS,
  CUISINE_OPTIONS,
  EXCLUSION_OPTIONS,
  RATE_OPTIONS,
  initialState,
  type Goal,
  type OnboardingState,
} from "./types";

const STEPS = ["goal", "rate", "activity", "stats"] as const;
type Step = (typeof STEPS)[number];

const GOALS: { value: Goal; label: string; desc: string }[] = [
  { value: "lose", label: "Lose weight", desc: "Steady fat loss while holding onto the muscle you have." },
  { value: "gain", label: "Gain weight (muscle)", desc: "Build muscle with a calorie surplus. Some fat gain comes with it." },
  { value: "recomp", label: "Body recomposition", desc: "Lose fat and build muscle at once — slower by nature, but no bulk-then-cut needed." },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<OnboardingState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const step: Step = STEPS[stepIndex];

  // The stats step is the only one that can be wrong by being skipped:
  // every other step shows its choice already made on screen. A zero
  // height or an unchosen sex produces a confident, wrong calorie target.
  const statsComplete =
    state.height_cm > 0 && state.weight_kg > 0 && state.age > 0 && state.sex !== null;
  const canAdvance = step !== "stats" || statsComplete;

  // Route guard: onboarding requires a signed-in session.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace("/login");
    });
  }, [router]);

  function update<K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Not logged in");
      setSubmitting(false);
      return;
    }
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(state),
    });
    if (!res.ok) {
      setError(`Save failed: ${res.status}`);
      setSubmitting(false);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md border border-border bg-surface p-6">
        <div className="mb-6 flex gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1 flex-1 ${i <= stepIndex ? "bg-accent" : "bg-border"}`}
            />
          ))}
        </div>
        <p className="mb-1 text-xs font-bold tracking-widest text-accent uppercase">
          Step {stepIndex + 1} of {STEPS.length}
        </p>

        {step === "goal" && (
          <GoalStep goal={state.goal} onSelect={(g) => update("goal", g)} />
        )}
        {step === "rate" && (
          <RateStep
            goal={state.goal}
            rate={state.rate_lb_per_week}
            onSelect={(r) => update("rate_lb_per_week", r)}
          />
        )}
        {step === "activity" && (
          <ActivityStep
            gymDays={state.gym_days}
            trainingType={state.training_type}
            activity={state.activity_level}
            onGymDays={(n) => update("gym_days", n)}
            onTrainingType={(t) => update("training_type", t)}
            onActivity={(a) => update("activity_level", a)}
          />
        )}
        {step === "stats" && (
          <StatsStep state={state} update={update} />
        )}

        {error && <p className="mt-4 text-sm font-semibold text-warn">{error}</p>}

        <div className="mt-6 flex gap-3">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={() => setStepIndex((i) => i - 1)}
              className="border border-border px-4 py-3 text-sm font-bold text-ink"
            >
              Back
            </button>
          )}
          <button
            type="button"
            disabled={submitting || !canAdvance}
            onClick={() => {
              if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
              else submit();
            }}
            className="flex-1 bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
          >
            {stepIndex < STEPS.length - 1
              ? "Continue"
              : submitting
                ? "Saving..."
                : statsComplete
                  ? "See my targets"
                  : "Fill in your stats"}
          </button>
        </div>
      </div>
    </main>
  );
}

function GoalStep({ goal, onSelect }: { goal: Goal; onSelect: (g: Goal) => void }) {
  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">What&apos;s your goal?</h1>
      <p className="mb-5 text-sm text-ink-dim">
        This sets your starting calorie and protein targets. You can change it later.
      </p>
      <div className="flex flex-col gap-3">
        {GOALS.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => onSelect(g.value)}
            className={`border p-4 text-left ${
              goal === g.value ? "border-accent bg-accent/10" : "border-border bg-surface"
            }`}
          >
            <b className="block text-[0.98rem] font-bold text-ink">{g.label}</b>
            <small className="text-[0.8rem] leading-snug text-ink-dim">{g.desc}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function RateStep({
  goal,
  rate,
  onSelect,
}: {
  goal: Goal;
  rate: number;
  onSelect: (r: number) => void;
}) {
  const options = RATE_OPTIONS[goal];
  const isAggressive = rate === options[options.length - 1] && rate !== 0;
  const subtext =
    goal === "recomp"
      ? "Recomp targets maintenance calories — no rate to set."
      : goal === "lose"
        ? "Faster cuts mean more muscle loss along with fat."
        : "Faster bulks mean more fat gain along with muscle.";

  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">How aggressively?</h1>
      <p className="mb-5 text-sm text-ink-dim">{subtext}</p>
      <div className="flex gap-2">
        {options.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onSelect(r)}
            className={`flex-1 border p-3 text-center ${
              rate === r ? "border-accent bg-accent/10" : "border-border bg-surface"
            }`}
          >
            <b className="block text-base font-extrabold tabular-nums text-ink">
              {r === 0 ? "—" : r}
            </b>
            <span className="text-[0.68rem] text-ink-dim">{r === 0 ? "maintenance" : "lb/week"}</span>
          </button>
        ))}
      </div>
      {isAggressive && (
        <p className="mt-3 border border-warn/40 bg-warn/10 p-3 text-xs font-medium text-ink">
          Fastest pace — more {goal === "lose" ? "muscle loss along with the fat" : "fat gain along with the muscle"}.
          You can dial this back anytime.
        </p>
      )}
    </div>
  );
}

function ActivityStep({
  gymDays,
  trainingType,
  activity,
  onGymDays,
  onTrainingType,
  onActivity,
}: {
  gymDays: number;
  trainingType: string;
  activity: OnboardingState["activity_level"];
  onGymDays: (n: number) => void;
  onTrainingType: (t: string) => void;
  onActivity: (a: OnboardingState["activity_level"]) => void;
}) {
  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">Training &amp; activity</h1>
      <p className="mb-5 text-sm text-ink-dim">Used to estimate your daily energy burn.</p>

      <label className="mb-1.5 block text-xs font-semibold text-ink-dim">
        Training days per week
      </label>
      <div className="mb-4 flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => onGymDays(Math.max(0, gymDays - 1))}
          className="h-9 w-9 border border-border text-lg font-extrabold text-ink"
        >
          −
        </button>
        <b className="min-w-5 text-center text-lg tabular-nums text-ink">{gymDays}</b>
        <button
          type="button"
          onClick={() => onGymDays(Math.min(7, gymDays + 1))}
          className="h-9 w-9 border border-border text-lg font-extrabold text-ink"
        >
          +
        </button>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-ink-dim">
        What kind of training? (optional)
      </label>
      <input
        value={trainingType}
        onChange={(e) => onTrainingType(e.target.value)}
        placeholder="e.g. gym, running, swimming, dance, sports league..."
        className="mb-5 w-full border border-border bg-surface p-3 text-sm text-ink"
      />

      <label className="mb-1.5 block text-xs font-semibold text-ink-dim">
        Non-training activity level
      </label>
      <div className="flex flex-col gap-2.5">
        {ACTIVITY_LEVELS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => onActivity(a.value)}
            className={`border p-3 text-left ${
              activity === a.value ? "border-accent bg-accent/10" : "border-border bg-surface"
            }`}
          >
            <b className="block text-sm font-bold text-ink">{a.label}</b>
            <small className="text-xs text-ink-dim">{a.desc}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsStep({
  state,
  update,
}: {
  state: OnboardingState;
  update: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
}) {
  const [heightUnit, setHeightUnit] = useState<"ftin" | "cm">("ftin");
  const [weightUnit, setWeightUnit] = useState<"lb" | "kg">("lb");
  const ftIn = cmToFtIn(state.height_cm);

  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">Stats &amp; preferences</h1>
      <p className="mb-5 text-sm text-ink-dim">
        Cuisines and exclusions shape every meal photo you log.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3">
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
                value={ftIn.ft || ""}
                onChange={(e) =>
                  update("height_cm", ftInToCm(Number(e.target.value) || 0, ftIn.inch))
                }
                placeholder="ft"
                className="w-full border border-border bg-surface p-3 text-sm text-ink"
              />
              <input
                type="number"
                step={0.5}
                value={ftIn.inch || ""}
                onChange={(e) =>
                  update("height_cm", ftInToCm(ftIn.ft, Number(e.target.value) || 0))
                }
                placeholder="in"
                className="w-full border border-border bg-surface p-3 text-sm text-ink"
              />
            </div>
          ) : (
            <input
              type="number"
              value={state.height_cm ? Math.round(state.height_cm) : ""}
              onChange={(e) => update("height_cm", Number(e.target.value) || 0)}
              className="w-full border border-border bg-surface p-3 text-sm text-ink"
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
            value={
              state.weight_kg
                ? weightUnit === "lb"
                  ? Math.round(kgToLb(state.weight_kg))
                  : Math.round(state.weight_kg)
                : ""
            }
            onChange={(e) => {
              const v = Number(e.target.value) || 0;
              update("weight_kg", weightUnit === "lb" ? lbToKg(v) : v);
            }}
            className="w-full border border-border bg-surface p-3 text-sm text-ink"
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-dim">Age</label>
          <input
            type="number"
            value={state.age || ""}
            onChange={(e) => update("age", Number(e.target.value) || 0)}
            className="w-full border border-border bg-surface p-3 text-sm text-ink"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-dim">Sex</label>
          <div className="flex gap-1.5">
            {(["male", "female"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update("sex", s)}
                className={`flex-1 border py-3 text-sm font-bold capitalize ${
                  state.sex === s ? "border-accent bg-accent text-[#1a1006]" : "border-border bg-surface text-ink"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-ink-dim">Cuisines you eat</label>
      <div className="mb-4">
        <ChipGroup
          options={CUISINE_OPTIONS}
          selected={state.cuisines}
          onChange={(next) => update("cuisines", next)}
          customPlaceholder="Type a cuisine..."
        />
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-ink-dim">
        Exclusions &amp; allergies
      </label>
      <ChipGroup
        options={EXCLUSION_OPTIONS}
        selected={state.exclusions}
        onChange={(next) => update("exclusions", next)}
        customPlaceholder="Type an allergy or exclusion..."
      />
      <p className="mt-2 text-xs text-ink-dim">
        Custom entries go straight into the vision AI&apos;s prompt too — not just a local label.
      </p>
    </div>
  );
}
