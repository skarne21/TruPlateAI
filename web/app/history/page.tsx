"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, requireSession } from "@/lib/api";
import { dayLabel } from "@/lib/day";
import { CameraIcon, ChevronDown, PencilIcon, TrashIcon } from "../components/icons";
import MealEditor from "./MealEditor";
import type { LoggedItem, LoggedMeal } from "./types";
import { LoadingScreen, Notice, Screen, TopBar } from "../components/ui";

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

/** Where a logged number came from, said in the same words as the review
 *  screen so a meal reads identically before and after it is saved. */
function sourceLine(item: LoggedItem): string {
  if (item.source === "barcode") return `${item.usda_description || item.name} · from the label`;
  if (item.source === "user") return item.usda_description || "your own food";
  if (item.source === "llm") return "AI estimate";
  return item.usda_description || "USDA";
}

export default function HistoryPage() {
  const router = useRouter();
  // One piece of state holding the outcome, so nothing has to be set from the
  // effect body: `meals: null` means the request failed, and a `days` that
  // doesn't match the selected range means it's still in flight.
  const [loaded, setLoaded] = useState<{ days: number; meals: LoggedMeal[] | null } | null>(null);
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const meals = loaded?.meals ?? [];
  const status = loaded?.days !== days ? "loading" : loaded.meals === null ? "error" : "ready";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const session = await requireSession(router);
      if (cancelled || !session) return;
      const res = await apiFetch(`/meals?days=${days}`);
      if (cancelled) return;
      setLoaded({ days, meals: res.ok ? await res.json() : null });
    }
    load().catch(() => setLoaded({ days, meals: null }));
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

  if (!loaded) return <LoadingScreen />;

  return (
    <Screen>
      <TopBar title="History" subtitle="Everything you've logged" back="/you" />

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1">
        {RANGES.map((range) => (
          <button
            key={range.days}
            type="button"
            onClick={() => setDays(range.days)}
            aria-pressed={days === range.days}
            className={`rounded-full py-2.5 text-[0.8rem] font-extrabold transition-colors ${
              days === range.days ? "bg-surface text-ink shadow-sm" : "text-ink-dim"
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      {status === "loading" && (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
        </div>
      )}

      {status === "error" && <Notice tone="warn">Couldn&apos;t load your history.</Notice>}

      {status === "ready" && meals.length === 0 && (
        <div className="card flex flex-col items-center px-5 py-8 text-center">
          <span className="mb-2 text-3xl">📭</span>
          <p className="mb-4 text-[0.82rem] text-ink-dim">Nothing logged in this period.</p>
          <Link href="/log" className="btn btn-primary w-full">
            <CameraIcon className="h-5 w-5" />
            Log a meal
          </Link>
        </div>
      )}

      {status === "ready" &&
        byDay(meals).map(([day, dayMeals]) => {
          const total = dayMeals.reduce((sum, m) => sum + (m.kcal ?? 0), 0);
          return (
            <section key={day} className="rise mb-5">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <b className="text-[0.9rem] font-extrabold text-ink">{dayLabel(day)}</b>
                <span className="text-[0.72rem] font-bold text-ink-dim tabular-nums">
                  {round(total).toLocaleString()} kcal · {dayMeals.length}{" "}
                  {dayMeals.length === 1 ? "meal" : "meals"}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {dayMeals.map((meal) => {
                  const expanded = open === meal.id;
                  return (
                    <div key={meal.id} className="card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : meal.id)}
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <b className="block truncate text-[0.88rem] font-bold text-ink">
                            {meal.caption ||
                              meal.items.map((i) => i.name).join(", ") ||
                              "Meal"}
                          </b>
                          <span className="text-[0.7rem] font-semibold text-ink-dim tabular-nums">
                            <span className="text-protein">{round(meal.protein_g)}p</span> ·{" "}
                            <span className="text-carbs">{round(meal.carbs_g)}c</span> ·{" "}
                            <span className="text-fat">{round(meal.fat_g)}f</span>
                          </span>
                        </div>
                        <span className="shrink-0 text-[0.95rem] font-extrabold text-ink tabular-nums">
                          {round(meal.kcal)}
                          <span className="text-[0.68rem] font-bold text-ink-dim"> kcal</span>
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-ink-dim transition-transform ${
                            expanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      {expanded && editing === meal.id && (
                        <MealEditor
                          meal={meal}
                          onCancel={() => setEditing(null)}
                          onSaved={(items, caption, totals) => {
                            // Patched in place rather than refetched: the
                            // server just told us the totals it stored, and a
                            // reload would throw away the open card.
                            setLoaded((prev) =>
                              prev?.meals
                                ? {
                                    ...prev,
                                    meals: prev.meals.map((m) =>
                                      m.id === meal.id
                                        ? { ...m, items, caption, ...totals }
                                        : m
                                    ),
                                  }
                                : prev
                            );
                            setEditing(null);
                          }}
                        />
                      )}

                      {expanded && editing !== meal.id && (
                        <div className="border-t border-border bg-surface-2 px-4 py-3">
                          {meal.items.map((item, index) => (
                            <div
                              key={index}
                              className="mb-2 flex items-baseline justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <span className="text-[0.8rem] font-semibold text-ink">
                                  {item.name}
                                </span>
                                {/* Showing where the number came from is what
                                    makes a logged meal checkable against a
                                    weighed one. */}
                                <span className="block truncate text-[0.68rem] text-ink-dim">
                                  {Math.round(item.grams)}g · {sourceLine(item)}
                                </span>
                              </div>
                              <span className="shrink-0 text-[0.75rem] font-semibold text-ink-dim tabular-nums">
                                {round(item.kcal)} kcal
                              </span>
                            </div>
                          ))}
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEditing(meal.id)}
                              className="btn btn-ghost min-h-10 flex-1 text-[0.78rem]"
                            >
                              <PencilIcon className="h-4 w-4" />
                              Edit this meal
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(meal.id)}
                              className="btn min-h-10 px-4 text-[0.78rem] text-warn"
                            >
                              <TrashIcon className="h-4 w-4" />
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
    </Screen>
  );
}
