"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

type LoggedItem = {
  name: string;
  grams: number;
  kcal: number | null;
  protein_g: number | null;
  source: string | null;
  usda_description: string | null;
};

type LoggedMeal = {
  id: string;
  logged_on: string;
  input_mode: string;
  caption: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  items: LoggedItem[];
};

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

const round = (n: number | null) => Math.round(n ?? 0);

/** Group meals under the day they were eaten, newest day first. */
function byDay(meals: LoggedMeal[]): [string, LoggedMeal[]][] {
  const groups = new Map<string, LoggedMeal[]>();
  for (const meal of meals) {
    groups.set(meal.logged_on, [...(groups.get(meal.logged_on) ?? []), meal]);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function dayLabel(iso: string): string {
  const today = new Date();
  const date = new Date(`${iso}T00:00:00`);
  const days = Math.round((+new Date(today.toDateString()) - +date) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function HistoryPage() {
  const router = useRouter();
  // One piece of state holding the outcome, so nothing has to be set from the
  // effect body: `meals: null` means the request failed, and a `days` that
  // doesn't match the selected range means it's still in flight.
  const [loaded, setLoaded] = useState<{ days: number; meals: LoggedMeal[] | null } | null>(null);
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState<string | null>(null);

  const meals = loaded?.meals ?? [];
  const status =
    loaded?.days !== days ? "loading" : loaded.meals === null ? "error" : "ready";

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
      const res = await apiFetch(`/meals?days=${days}`);
      if (cancelled) return;
      setLoaded({ days, meals: res.ok ? await res.json() : null });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router, days]);

  async function remove(id: string) {
    // Removed from view first so the correction feels immediate; the row is
    // gone from the server either way and a failure just means a stale list
    // until the next load.
    setLoaded((prev) =>
      prev?.meals ? { ...prev, meals: prev.meals.filter((m) => m.id !== id) } : prev
    );
    await apiFetch(`/meals/${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm text-ink-dim">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest text-accent uppercase">History</p>
            <p className="text-sm text-ink-dim">Everything you&apos;ve logged.</p>
          </div>
          <Link href="/dashboard" className="text-xs font-bold text-ink-dim underline underline-offset-2">
            Back
          </Link>
        </div>

        <div className="mb-4 flex gap-2">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={`flex-1 border px-3 py-2 text-sm font-semibold ${
                days === range.days
                  ? "border-accent bg-accent text-[#1a1006]"
                  : "border-border bg-surface text-ink"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        {status === "error" && (
          <p className="text-sm font-semibold text-warn">Couldn&apos;t load your history.</p>
        )}

        {status === "ready" && meals.length === 0 && (
          <p className="border border-border bg-surface p-3.5 text-xs text-ink-dim">
            Nothing logged in this period.{" "}
            <Link href="/log" className="font-bold text-accent underline underline-offset-2">
              Log a meal
            </Link>
            .
          </p>
        )}

        {byDay(meals).map(([day, dayMeals]) => {
          const total = dayMeals.reduce((sum, m) => sum + (m.kcal ?? 0), 0);
          return (
            <div key={day} className="mb-5">
              <div className="mb-2 flex items-baseline justify-between">
                <b className="text-sm font-extrabold text-ink">{dayLabel(day)}</b>
                <span className="text-xs font-semibold text-ink-dim tabular-nums">
                  {round(total).toLocaleString()} kcal · {dayMeals.length}{" "}
                  {dayMeals.length === 1 ? "meal" : "meals"}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {dayMeals.map((meal) => (
                  <div key={meal.id} className="border border-border bg-surface p-3.5">
                    <button
                      type="button"
                      onClick={() => setOpen(open === meal.id ? null : meal.id)}
                      className="flex w-full items-start justify-between gap-2 text-left"
                    >
                      <div className="min-w-0">
                        <b className="block truncate text-sm font-bold text-ink">
                          {meal.caption || meal.items.map((i) => i.name).join(", ") || "Meal"}
                        </b>
                        <small className="text-xs text-ink-dim tabular-nums">
                          {round(meal.protein_g)}p · {round(meal.carbs_g)}c · {round(meal.fat_g)}f
                        </small>
                      </div>
                      <span className="shrink-0 text-sm font-extrabold text-ink tabular-nums">
                        {round(meal.kcal)} kcal
                      </span>
                    </button>

                    {open === meal.id && (
                      <div className="mt-3 border-t border-border pt-3">
                        {meal.items.map((item, index) => (
                          <div key={index} className="mb-1.5 flex items-baseline justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs font-semibold text-ink">{item.name}</span>
                              {/* Showing where the number came from is what makes
                                  a logged meal checkable against a weighed one. */}
                              <span className="block truncate text-[0.68rem] text-ink-dim">
                                {Math.round(item.grams)}g ·{" "}
                                {item.source === "barcode"
                                  ? `${item.usda_description || item.name} · from the label`
                                  : item.source === "user"
                                    ? item.usda_description || "your own food"
                                    : item.source === "llm"
                                      ? "AI estimate"
                                      : item.usda_description || "USDA"}
                              </span>
                            </div>
                            <span className="shrink-0 text-xs text-ink-dim tabular-nums">
                              {round(item.kcal)} kcal
                            </span>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => remove(meal.id)}
                          className="mt-2 border border-warn/50 px-2.5 py-1 text-xs font-bold text-warn"
                        >
                          Delete this meal
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
