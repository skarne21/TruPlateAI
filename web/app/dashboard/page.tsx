"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

type DayTotals = {
  date: string;
  consumed: Record<string, number>;
  targets: Record<string, number>;
  remaining: Record<string, number>;
  meal_count: number;
};

// Every destination is real now.
const NAV_ITEMS = [
  { label: "Today", href: "/dashboard" },
  { label: "Log", href: "/log" },
  { label: "Coach", href: "/coach" },
  { label: "Foodie", href: "/foodie" },
  { label: "Weigh-in", href: "/weight" },
];

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [day, setDay] = useState<DayTotals | null>(null);
  const [status, setStatus] = useState<"loading" | "no-profile" | "error" | "ready">("loading");

  useEffect(() => {
    // Guards against a stale fetch (e.g. a fast logout -> login) landing after a
    // newer one and clobbering state with an outdated response.
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

      const res = await apiFetch(`/dashboard/today?date=${localDate()}`);
      if (cancelled) return;
      if (res.status === 404 || res.status === 406) {
        setStatus("no-profile");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setDay(data);
      setStatus("ready");
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
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
          <p className="mb-4 text-sm text-ink-dim">You haven&apos;t completed onboarding yet.</p>
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

  if (status === "error" || !day) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm font-semibold text-warn">
          Couldn&apos;t load today&apos;s totals. Try refreshing.
        </p>
      </main>
    );
  }

  const remaining = Math.round(day.remaining.kcal);
  const over = remaining < 0;

  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-ink-dim">Today</p>
            <p className="text-base font-extrabold text-ink">
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-xs font-bold text-ink-dim underline underline-offset-2"
          >
            Log out
          </button>
        </div>

        <div className="relative mb-4 border border-border bg-surface p-7">
          <div className="pointer-events-none absolute top-2 right-2 h-28 w-28 rounded-full bg-accent/30 blur-2xl" />
          <div className="relative flex items-baseline gap-1.5">
            <span className="text-5xl font-extrabold tracking-tight text-ink tabular-nums">
              {Math.abs(remaining).toLocaleString()}
            </span>
            <span className="text-base font-bold text-ink-dim">kcal {over ? "over" : "left"}</span>
          </div>
          <p className="relative mt-3 text-sm text-ink-dim tabular-nums">
            {Math.round(day.consumed.kcal).toLocaleString()} of{" "}
            {Math.round(day.targets.kcal).toLocaleString()} kcal · {day.meal_count}{" "}
            {day.meal_count === 1 ? "meal" : "meals"} logged
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <div className="border border-border bg-surface p-3.5">
            <b className="block text-xl font-extrabold text-ink tabular-nums">
              {Math.round(day.consumed.protein_g)}g
            </b>
            <span className="text-xs font-semibold text-ink-dim">
              protein of {Math.round(day.targets.protein_g)}g
            </span>
          </div>
          <div className="border border-border bg-surface p-3.5">
            <b className="block text-xl font-extrabold text-ink tabular-nums">
              {Math.round(day.consumed.carbs_g)}g / {Math.round(day.consumed.fat_g)}g
            </b>
            <span className="text-xs font-semibold text-ink-dim">carbs / fat</span>
          </div>
        </div>

        <Link
          href="/log"
          className="mb-4 block bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-center text-sm font-extrabold text-[#1a1006]"
        >
          Log a meal
        </Link>

        <div className="flex border-t border-border bg-surface px-2 py-2.5">
          {NAV_ITEMS.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="flex-1 text-center text-[0.68rem] font-bold text-ink"
              >
                {item.label}
              </Link>
            ) : (
              <div
                key={item.label}
                className="flex-1 text-center text-[0.68rem] font-bold text-ink-dim opacity-50"
              >
                {item.label}
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}
