"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type TargetsResult = {
  bmr: number;
  tdee: number;
  kcal_target: number;
  protein_g: number;
  explanation: string;
};

// Bottom nav preview -- only "Today" is real in Phase 0. The rest are
// inert (no onClick, dimmed) so it's honest about what's actually built,
// not a promise of features that don't exist yet.
const NAV_ITEMS = [
  { label: "Today", active: true },
  { label: "Log", active: false },
  { label: "Coach", active: false },
  { label: "Foodie", active: false },
  { label: "Profile", active: false },
];

export default function DashboardPage() {
  const router = useRouter();
  const [targets, setTargets] = useState<TargetsResult | null>(null);
  const [status, setStatus] = useState<"loading" | "no-profile" | "error" | "ready">("loading");

  useEffect(() => {
    // Guards against a stale fetch (e.g. a fast logout -> login) landing
    // after a newer one and clobbering state with an outdated response.
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/profile`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (cancelled) return;
      if (res.status === 406 || res.status === 404) {
        setStatus("no-profile");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setTargets(await res.json());
      if (cancelled) return;
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
          <Link href="/onboarding" className="bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006]">
            Complete onboarding
          </Link>
        </div>
      </main>
    );
  }

  if (status === "error" || !targets) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm font-semibold text-warn">Couldn&apos;t load your targets. Try refreshing.</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-ink-dim">Today</p>
            <p className="text-base font-extrabold text-ink">
              {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </p>
          </div>
          <button type="button" onClick={logout} className="text-xs font-bold text-ink-dim underline underline-offset-2">
            Log out
          </button>
        </div>

        <div className="relative mb-4 overflow-hidden border border-border bg-surface p-7">
          <div className="pointer-events-none absolute -top-5 -right-5 h-40 w-40 rounded-full bg-accent/40 blur-2xl" />
          <div className="relative flex items-baseline gap-1.5">
            <span className="text-5xl font-extrabold tracking-tight text-ink tabular-nums">
              {Math.round(targets.kcal_target).toLocaleString()}
            </span>
            <span className="text-base font-bold text-ink-dim">kcal target</span>
          </div>
          <p className="relative mt-3 text-sm text-ink-dim">{targets.explanation}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <div className="border border-border bg-surface p-3.5">
            <b className="block text-xl font-extrabold tabular-nums text-ink">
              {Math.round(targets.protein_g)}g
            </b>
            <span className="text-xs font-semibold text-ink-dim">protein target</span>
          </div>
          <div className="border border-border bg-surface p-3.5">
            <b className="block text-xl font-extrabold tabular-nums text-ink">
              {Math.round(targets.tdee).toLocaleString()}
            </b>
            <span className="text-xs font-semibold text-ink-dim">maintenance kcal</span>
          </div>
        </div>

        <p className="mb-4 text-center text-xs text-ink-dim">
          Meal logging isn&apos;t built yet — that&apos;s Phase 1.
        </p>

        <div className="flex border-t border-border bg-surface px-2 py-2.5">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.label}
              className={`flex-1 text-center text-[0.68rem] font-bold ${
                item.active ? "text-ink" : "text-ink-dim opacity-50"
              }`}
            >
              {item.label}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
