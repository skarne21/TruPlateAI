"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, requireSession } from "@/lib/api";
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from "@/lib/units";
import { ArrowLeft } from "../components/icons";
import { Confetti, CountUp, Notice, Screen, haptic } from "../components/ui";
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

const GOALS: { value: Goal; label: string; desc: string; emoji: string }[] = [
  {
    value: "lose",
    label: "Lose weight",
    emoji: "🔻",
    desc: "Steady fat loss while holding onto the muscle you have.",
  },
  {
    value: "gain",
    label: "Gain weight (muscle)",
    emoji: "💪",
    desc: "Build muscle with a calorie surplus. Some fat gain comes with it.",
  },
  {
    value: "recomp",
    label: "Body recomposition",
    emoji: "⚖️",
    desc: "Lose fat and build muscle at once — slower by nature, but no bulk-then-cut needed.",
  },
];

type Targets = { kcal_target: number; protein_g: number };

export default function OnboardingPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<OnboardingState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [targets, setTargets] = useState<Targets | null>(null);
  const step: Step = STEPS[stepIndex];

  // The stats step is the only one that can be wrong by being skipped:
  // every other step shows its choice already made on screen. A zero
  // height or an unchosen sex produces a confident, wrong calorie target.
  const statsComplete =
    state.height_cm > 0 && state.weight_kg > 0 && state.age > 0 && state.sex !== null;
  const canAdvance = step !== "stats" || statsComplete;

  // Route guard: onboarding requires a signed-in session.
  useEffect(() => {
    requireSession(router).catch(() => setError("Can't reach the server. Check your connection."));
  }, [router]);

  function update<K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/profile", { method: "POST", body: JSON.stringify(state) });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setTargets(await res.json());
      haptic([14, 50, 14, 50, 22]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  // The payoff for four screens of questions: the numbers, revealed rather
  // than just landed on. Everything before this was a form; this is the app.
  if (targets) {
    return (
      <Screen tabs={false}>
        <Confetti />
        <div className="flex min-h-screen flex-col justify-center py-10">
          <p className="mb-1 text-center text-[0.72rem] font-extrabold tracking-widest text-accent uppercase">
            You&apos;re set up
          </p>
          <h1 className="mb-6 text-center text-2xl font-extrabold text-ink">
            Here are your daily targets
          </h1>

          <div className="card card-lift pop px-6 py-7 text-center">
            <p className="text-6xl leading-none font-extrabold tracking-tight text-ink">
              <CountUp value={Math.round(targets.kcal_target)} duration={1100} />
            </p>
            <p className="mt-1 text-[0.8rem] font-bold tracking-wide text-ink-dim uppercase">
              kcal per day
            </p>
            <div className="mt-6 rounded-xl bg-surface-2 px-4 py-3">
              <p className="text-2xl font-extrabold text-protein tabular-nums">
                {Math.round(targets.protein_g)}g
              </p>
              <p className="text-[0.7rem] font-bold text-ink-dim">protein per day</p>
            </div>
          </div>

          <p className="mt-4 mb-6 text-center text-[0.78rem] text-ink-dim">
            Calculated from your own numbers, and re-checked against your real weigh-ins as you
            go. Nothing here is fixed.
          </p>

          <button
            type="button"
            onClick={() => router.push("/log")}
            className="btn btn-primary w-full"
          >
            Log my first meal
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="btn btn-quiet mt-2.5 w-full"
          >
            Take me to the dashboard
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen tabs={false}>
      <div className="safe-top flex min-h-screen flex-col py-6">
        <div className="mb-6 flex items-center gap-3">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={() => setStepIndex((i) => i - 1)}
              aria-label="Back"
              className="btn btn-ghost h-10 w-10 min-h-0 shrink-0 p-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          {/* One bar per step rather than a percentage: you can see how much is
              left, which is what makes a four-step form feel short. */}
          <div className="flex flex-1 gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= stepIndex ? "bg-accent" : "bg-track"
                }`}
              />
            ))}
          </div>
          <span className="shrink-0 text-[0.7rem] font-extrabold text-ink-dim tabular-nums">
            {stepIndex + 1}/{STEPS.length}
          </span>
        </div>

        <div key={step} className="rise flex-1">
          {step === "goal" && <GoalStep goal={state.goal} onSelect={(g) => update("goal", g)} />}
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
          {step === "stats" && <StatsStep state={state} update={update} />}
        </div>

        {error && (
          <div className="mt-4">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        <button
          type="button"
          disabled={submitting || !canAdvance}
          onClick={() => {
            haptic();
            if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
            else submit();
          }}
          className="btn btn-primary mt-6 w-full"
        >
          {stepIndex < STEPS.length - 1
            ? "Continue"
            : submitting
              ? "Working it out…"
              : statsComplete
                ? "See my targets"
                : "Fill in your stats"}
        </button>
      </div>
    </Screen>
  );
}

function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
      <p className="mb-5 text-[0.85rem] text-ink-dim">{sub}</p>
    </>
  );
}

function GoalStep({ goal, onSelect }: { goal: Goal; onSelect: (g: Goal) => void }) {
  return (
    <div>
      <StepHead
        title="What are you after?"
        sub="This sets your starting calorie and protein targets. You can change it later."
      />
      <div className="flex flex-col gap-2.5">
        {GOALS.map((g) => (
          <button
            key={g.value}
            type="button"
            data-on={goal === g.value}
            onClick={() => onSelect(g.value)}
            className="choice flex items-start gap-3 px-4 py-4 text-left"
          >
            <span className="text-2xl" aria-hidden>
              {g.emoji}
            </span>
            <span className="min-w-0">
              <b className="block text-[0.95rem] font-bold text-ink">{g.label}</b>
              <small className="text-[0.8rem] leading-snug text-ink-dim">{g.desc}</small>
            </span>
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
        ? "Faster cuts mean more muscle loss along with the fat."
        : "Faster bulks mean more fat gain along with the muscle.";

  return (
    <div>
      <StepHead title="How aggressively?" sub={subtext} />
      <div className="flex gap-2.5">
        {options.map((r) => (
          <button
            key={r}
            type="button"
            data-on={rate === r}
            onClick={() => onSelect(r)}
            className="choice flex-1 px-2 py-5 text-center"
          >
            <b className="block text-2xl font-extrabold text-ink tabular-nums">
              {r === 0 ? "—" : r}
            </b>
            <span className="text-[0.7rem] font-semibold text-ink-dim">
              {r === 0 ? "maintenance" : "lb / week"}
            </span>
          </button>
        ))}
      </div>
      {isAggressive && (
        <div className="mt-4">
          <Notice tone="warn">
            Fastest pace — more{" "}
            {goal === "lose" ? "muscle loss along with the fat" : "fat gain along with the muscle"}
            . You can dial this back anytime.
          </Notice>
        </div>
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
      <StepHead title="Training & activity" sub="Used to estimate your daily energy burn." />

      <label className="mb-2 block text-[0.75rem] font-bold text-ink-dim">
        Training days per week
      </label>
      <div className="mb-5 flex items-center justify-center gap-6 rounded-2xl bg-surface-2 py-4">
        <button
          type="button"
          onClick={() => onGymDays(Math.max(0, gymDays - 1))}
          aria-label="One fewer training day"
          className="btn btn-ghost h-11 w-11 min-h-0 p-0 text-xl"
        >
          −
        </button>
        <b className="min-w-10 text-center text-3xl font-extrabold text-ink tabular-nums">
          {gymDays}
        </b>
        <button
          type="button"
          onClick={() => onGymDays(Math.min(7, gymDays + 1))}
          aria-label="One more training day"
          className="btn btn-ghost h-11 w-11 min-h-0 p-0 text-xl"
        >
          +
        </button>
      </div>

      <label className="mb-2 block text-[0.75rem] font-bold text-ink-dim">
        What kind of training? (optional)
      </label>
      <input
        value={trainingType}
        onChange={(e) => onTrainingType(e.target.value)}
        placeholder="gym, running, swimming, dance, a sports league…"
        className="field mb-5"
      />

      <label className="mb-2 block text-[0.75rem] font-bold text-ink-dim">
        Non-training activity level
      </label>
      <div className="flex flex-col gap-2">
        {ACTIVITY_LEVELS.map((a) => (
          <button
            key={a.value}
            type="button"
            data-on={activity === a.value}
            onClick={() => onActivity(a.value)}
            className="choice px-3.5 py-3 text-left"
          >
            <b className="block text-[0.85rem] font-bold text-ink">{a.label}</b>
            <small className="text-[0.72rem] text-ink-dim">{a.desc}</small>
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
      <StepHead
        title="A few numbers"
        sub="These decide your targets. Cuisines and exclusions shape every meal photo you log."
      />

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
                inputMode="numeric"
                aria-label="Height, feet"
                value={ftIn.ft || ""}
                onChange={(e) =>
                  update("height_cm", ftInToCm(Number(e.target.value) || 0, ftIn.inch))
                }
                placeholder="ft"
                className="field text-center tabular-nums"
              />
              <input
                type="number"
                step={0.5}
                inputMode="decimal"
                aria-label="Height, inches"
                value={ftIn.inch || ""}
                onChange={(e) =>
                  update("height_cm", ftInToCm(ftIn.ft, Number(e.target.value) || 0))
                }
                placeholder="in"
                className="field text-center tabular-nums"
              />
            </div>
          ) : (
            <input
              type="number"
              inputMode="numeric"
              aria-label="Height in centimetres"
              value={state.height_cm ? Math.round(state.height_cm) : ""}
              placeholder="cm"
              onChange={(e) => update("height_cm", Number(e.target.value) || 0)}
              className="field text-center tabular-nums"
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
            inputMode="decimal"
            aria-label={`Weight in ${weightUnit}`}
            value={
              state.weight_kg
                ? weightUnit === "lb"
                  ? Math.round(kgToLb(state.weight_kg))
                  : Math.round(state.weight_kg)
                : ""
            }
            placeholder={weightUnit}
            onChange={(e) => {
              const v = Number(e.target.value) || 0;
              update("weight_kg", weightUnit === "lb" ? lbToKg(v) : v);
            }}
            className="field text-center tabular-nums"
          />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[0.72rem] font-bold text-ink-dim">Age</label>
          <input
            type="number"
            inputMode="numeric"
            value={state.age || ""}
            placeholder="years"
            onChange={(e) => update("age", Number(e.target.value) || 0)}
            className="field text-center tabular-nums"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[0.72rem] font-bold text-ink-dim">Sex</label>
          <div className="flex gap-2">
            {(["male", "female"] as const).map((s) => (
              <button
                key={s}
                type="button"
                data-on={state.sex === s}
                onClick={() => update("sex", s)}
                className="choice flex-1 py-3 text-[0.82rem] font-bold text-ink capitalize"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="mb-2 block text-[0.75rem] font-bold text-ink-dim">Cuisines you eat</label>
      <div className="mb-5">
        <ChipGroup
          options={CUISINE_OPTIONS}
          selected={state.cuisines}
          onChange={(next) => update("cuisines", next)}
          customPlaceholder="Type a cuisine…"
        />
      </div>

      <label className="mb-2 block text-[0.75rem] font-bold text-ink-dim">
        Exclusions &amp; allergies
      </label>
      <ChipGroup
        options={EXCLUSION_OPTIONS}
        selected={state.exclusions}
        onChange={(next) => update("exclusions", next)}
        customPlaceholder="Type an allergy or exclusion…"
      />
      <p className="mt-2.5 text-[0.72rem] text-ink-dim">
        Custom entries go straight into the vision AI&apos;s prompt too — not just a local label.
      </p>
    </div>
  );
}
