"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, requireSession } from "@/lib/api";
import { lastSevenDays, localDate, streakFrom } from "@/lib/day";
import { CalorieRing, MacroBars } from "../components/Rings";
import {
  BarcodeIcon,
  CameraIcon,
  ChevronRight,
  CogIcon,
  FlameIcon,
  FoodieIcon,
  MicIcon,
} from "../components/icons";
import {
  LoadingScreen,
  NeedsOnboarding,
  Notice,
  Screen,
  Skeleton,
  TopBar,
} from "../components/ui";

type DayTotals = {
  date: string;
  consumed: Record<string, number>;
  targets: Record<string, number>;
  remaining: Record<string, number>;
  meal_count: number;
};

type Meal = {
  id: string;
  logged_on: string;
  caption: string | null;
  kcal: number | null;
  protein_g: number | null;
  items: { name: string }[];
};

// Enough history to draw the week strip and count a streak worth being proud
// of, without pulling the user's whole log onto the home screen.
const HISTORY_DAYS = 60;

const QUICK_ACTIONS = [
  { href: "/log?mode=photo", label: "Photo", hint: "Snap it", Icon: CameraIcon },
  { href: "/log?mode=describe", label: "Describe", hint: "Type or talk", Icon: MicIcon },
  { href: "/log?mode=scan", label: "Scan", hint: "Barcode", Icon: BarcodeIcon },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const router = useRouter();
  const [day, setDay] = useState<DayTotals | null>(null);
  const [meals, setMeals] = useState<Meal[] | null>(null);
  // Distinct from "not here yet": showing "Start a streak" to someone on a
  // 30-day run is the exact bug this card was designed to avoid, so a failure
  // says so rather than rendering a confident zero.
  const [streakError, setStreakError] = useState(false);
  const [status, setStatus] = useState<"loading" | "no-profile" | "error" | "ready">("loading");

  useEffect(() => {
    // Guards against a stale fetch (e.g. a fast logout -> login) landing after
    // a newer one and clobbering state with an outdated response.
    let cancelled = false;

    async function load() {
      const session = await requireSession(router);
      if (cancelled || !session) return;

      const today = localDate();

      // Deliberately not Promise.all. The ring is the reason this screen
      // exists and needs one small request; the streak strip needs sixty days
      // of meals. Awaiting both together made the headline number wait on data
      // it does not use -- on a cold API that is seconds of blank screen for
      // nothing.
      const dayRes = await apiFetch(`/dashboard/today?date=${today}`);
      if (cancelled) return;

      if (dayRes.status === 404 || dayRes.status === 406) {
        setStatus("no-profile");
        return;
      }
      if (!dayRes.ok) {
        setStatus("error");
        return;
      }

      setDay(await dayRes.json());
      setStatus("ready");

      // Caught here rather than on the outer promise: by this point the
      // dashboard is already on screen and usable, so a failed streak fetch
      // must degrade this one card, not blank the whole page.
      try {
        const mealsRes = await apiFetch(`/meals?days=${HISTORY_DAYS}`);
        if (cancelled) return;
        if (!mealsRes.ok) throw new Error(String(mealsRes.status));
        setMeals(await mealsRes.json());
      } catch {
        if (!cancelled) setStreakError(true);
      }
    }

    load().catch(() => setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status === "loading") return <LoadingScreen />;
  if (status === "no-profile") return <NeedsOnboarding />;

  if (status === "error" || !day) {
    return (
      <Screen>
        <TopBar title="Today" />
        <Notice tone="warn">
          Couldn&apos;t load today&apos;s totals. Check your connection and pull to refresh.
        </Notice>
      </Screen>
    );
  }

  const today = localDate();
  const loggedDays = new Set((meals ?? []).map((m) => m.logged_on));
  const streak = streakFrom(loggedDays, today);
  const week = lastSevenDays(loggedDays, today);
  const todaysMeals = (meals ?? []).filter((m) => m.logged_on === today);
  const remaining = Math.round(day.remaining.kcal);

  return (
    <Screen>
      <TopBar
        title={greeting()}
        subtitle={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        right={
          <Link
            href="/settings"
            aria-label="Settings"
            className="btn btn-ghost h-10 w-10 min-h-0 shrink-0 p-0 text-ink-dim"
          >
            <CogIcon className="h-5 w-5" />
          </Link>
        }
      />

      {/* The hero. One number, arm's-length readable, and the ring fills as the
          screen opens so the day's progress is something you watch happen. */}
      <section className="card card-lift rise relative mb-3 overflow-hidden px-5 py-6">
        <div
          aria-hidden
          className="glow pointer-events-none absolute -top-16 -right-12 h-52 w-52 rounded-full bg-accent/25 blur-3xl"
        />
        <div className="relative flex flex-col items-center">
          <CalorieRing consumed={day.consumed.kcal} target={day.targets.kcal} />
          <p className="mt-4 text-center text-[0.8rem] text-ink-dim">
            {day.meal_count === 0
              ? "Nothing logged yet — the first one takes about ten seconds."
              : `${day.meal_count} ${day.meal_count === 1 ? "meal" : "meals"} logged today`}
          </p>
        </div>
      </section>

      <MacroBars consumed={day.consumed} targets={day.targets} className="rise rise-2 mb-3" />

      {/* Streaks work on anticipation, not punishment: a missed morning shows
          an invitation, never a scolding. */}
      <section className="card rise rise-3 mb-3 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlameIcon
              className={`h-5 w-5 ${streak > 0 ? "text-accent" : "text-ink-dim opacity-50"}`}
            />
            {/* A zero here before the data lands would read as "you broke your
                streak", which is the one thing this card must never say wrongly. */}
            {streakError ? (
              <b className="text-sm font-bold text-ink-dim">Streak unavailable</b>
            ) : meals === null ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <b className="text-sm font-extrabold text-ink">
                {streak > 0 ? `${streak} day streak` : "Start a streak"}
              </b>
            )}
          </div>
          {meals !== null && !streakError && (
            <span className="text-[0.7rem] font-semibold text-ink-dim">
              {loggedDays.has(today)
                ? "Today’s in the bag"
                : streak > 0
                  ? "Log today to keep it"
                  : "Log a meal to begin"}
            </span>
          )}
        </div>

        <div className="flex justify-between">
          {week.map((d) => (
            <div key={d.iso} className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[0.7rem] font-extrabold ${
                  d.logged
                    ? "bg-linear-to-br from-accent to-accent-2 text-on-accent"
                    : d.isToday
                      ? "border-2 border-dashed border-accent/50 text-ink-dim"
                      : "bg-surface-2 text-ink-dim"
                }`}
              >
                {d.logged ? "✓" : ""}
              </div>
              <span
                className={`text-[0.65rem] font-bold ${d.isToday ? "text-accent" : "text-ink-dim"}`}
              >
                {d.letter}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Three ways in, all visible. Hiding the barcode scanner behind a menu
          is how a feature stops existing. */}
      <div className="rise rise-4 mb-3 grid grid-cols-3 gap-2.5">
        {QUICK_ACTIONS.map(({ href, label, hint, Icon }) => (
          <Link
            key={href}
            href={href}
            className="card flex flex-col items-center gap-1.5 px-2 py-4 transition-transform active:scale-[0.97]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-accent">
              <Icon className="h-5 w-5" />
            </span>
            <b className="text-[0.8rem] font-extrabold text-ink">{label}</b>
            <span className="text-[0.65rem] text-ink-dim">{hint}</span>
          </Link>
        ))}
      </div>

      {remaining > 200 && (
        <Link
          href="/foodie"
          className="card rise mb-3 flex items-center gap-3 px-4 py-3.5 transition-transform active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbs/15 text-carbs">
            <FoodieIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <b className="block text-sm font-extrabold text-ink">
              {remaining.toLocaleString()} kcal left
            </b>
            <span className="text-[0.75rem] text-ink-dim">
              Ask Foodie what fits the rest of today
            </span>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-dim" />
        </Link>
      )}

      <section className="rise">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm font-extrabold text-ink">Today&apos;s meals</h2>
          <Link href="/history" className="text-[0.75rem] font-bold text-accent">
            See all
          </Link>
        </div>

        {meals === null && !streakError ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ) : todaysMeals.length === 0 ? (
          <div className="card flex flex-col items-center px-5 py-7 text-center">
            <span className="mb-2 text-3xl">🍽️</span>
            <p className="mb-4 text-[0.8rem] text-ink-dim">
              Nothing here yet. Photograph a plate and the macros come back grounded in the
              USDA database, not guessed.
            </p>
            <Link href="/log" className="btn btn-primary w-full">
              <CameraIcon className="h-5 w-5" />
              Log your first meal
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {todaysMeals.map((meal) => (
              <li key={meal.id} className="card flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[0.85rem] font-bold text-ink">
                    {meal.caption || meal.items.map((i) => i.name).join(", ") || "Meal"}
                  </b>
                  <span className="text-[0.7rem] text-ink-dim tabular-nums">
                    {Math.round(meal.protein_g ?? 0)}g protein
                  </span>
                </div>
                <span className="shrink-0 text-sm font-extrabold text-ink tabular-nums">
                  {Math.round(meal.kcal ?? 0)}
                  <span className="text-[0.7rem] font-bold text-ink-dim"> kcal</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}
