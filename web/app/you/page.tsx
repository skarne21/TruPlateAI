"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, requireSession } from "@/lib/api";
import { localDate, longestStreak, streakFrom } from "@/lib/day";
import { createClient } from "@/lib/supabase/client";
import {
  BookIcon,
  ChevronRight,
  CogIcon,
  FlameIcon,
  HistoryIcon,
  LogoutIcon,
  ScaleIcon,
  TrophyIcon,
} from "../components/icons";
import { CountUp, LoadFailed, LoadingScreen, Screen, TopBar } from "../components/ui";

type Meal = { id: string; logged_on: string; kcal: number | null };

// The same window the dashboard loads, so both screens agree on the streak.
const HISTORY_DAYS = 60;

const LINKS = [
  { href: "/weight", label: "Weigh-in", hint: "Targets learn from this", Icon: ScaleIcon },
  { href: "/history", label: "History", hint: "Everything you've logged", Icon: HistoryIcon },
  { href: "/foods", label: "My foods", hint: "Fix what the database gets wrong", Icon: BookIcon },
  { href: "/settings", label: "Settings", hint: "Goal, pace, allergies", Icon: CogIcon },
];

/** Milestones you reach by doing the thing, not by opening the app.
 *
 * Deliberately no leaderboards and no losing an earned badge: this is a health
 * app, and a reward you can be punished with stops being a reward. */
const BADGES = [
  { at: 1, emoji: "🌱", label: "First day" },
  { at: 3, emoji: "🔥", label: "3 in a row" },
  { at: 7, emoji: "⭐", label: "Full week" },
  { at: 14, emoji: "💪", label: "Two weeks" },
  { at: 30, emoji: "🏆", label: "A month" },
];

export default function YouPage() {
  const router = useRouter();
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const session = await requireSession(router);
      if (cancelled || !session) return;
      setEmail(session.user.email ?? null);

      const res = await apiFetch(`/meals?days=${HISTORY_DAYS}`);
      if (cancelled) return;
      setMeals(res.ok ? await res.json() : []);
    }
    load().catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  if (failed) return <LoadFailed what="your milestones" />;
  if (!meals) return <LoadingScreen />;

  const today = localDate();
  const loggedDays = new Set(meals.map((m) => m.logged_on));
  const streak = streakFrom(loggedDays, today);
  const best = longestStreak(loggedDays);

  return (
    <Screen>
      <TopBar title="You" subtitle={email ?? undefined} />

      <section className="card card-lift rise mb-3 overflow-hidden px-5 py-6 text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <FlameIcon className={`h-7 w-7 ${streak > 0 ? "text-accent" : "text-ink-dim opacity-50"}`} />
          <p className="text-5xl leading-none font-extrabold tracking-tight text-ink">
            <CountUp value={streak} />
          </p>
        </div>
        <p className="text-[0.8rem] font-bold text-ink-dim">
          {streak === 1 ? "day streak" : "day streak"}
          {best > streak && ` · best ${best}`}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-surface-2 px-3 py-3">
            <p className="text-xl font-extrabold text-ink tabular-nums">{loggedDays.size}</p>
            <p className="text-[0.68rem] font-bold text-ink-dim">days logged</p>
          </div>
          <div className="rounded-xl bg-surface-2 px-3 py-3">
            <p className="text-xl font-extrabold text-ink tabular-nums">{meals.length}</p>
            <p className="text-[0.68rem] font-bold text-ink-dim">meals logged</p>
          </div>
        </div>
        <p className="mt-2 text-[0.65rem] text-ink-dim">Last {HISTORY_DAYS} days</p>
      </section>

      <section className="card rise mb-3 px-4 py-4">
        <div className="mb-3 flex items-center gap-2">
          <TrophyIcon className="h-5 w-5 text-fat" />
          <b className="text-sm font-extrabold text-ink">Milestones</b>
        </div>
        <div className="scroll-x flex gap-2.5 pb-1">
          {BADGES.map((badge) => {
            const earned = best >= badge.at;
            return (
              <div
                key={badge.at}
                className={`flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-xl px-2 py-3 ${
                  earned ? "bg-accent/10" : "bg-surface-2"
                }`}
              >
                <span
                  className={`text-2xl ${earned ? "" : "opacity-25 grayscale"}`}
                  aria-hidden
                >
                  {badge.emoji}
                </span>
                <span
                  className={`text-center text-[0.62rem] font-bold ${
                    earned ? "text-ink" : "text-ink-dim"
                  }`}
                >
                  {badge.label}
                </span>
                <span className="sr-only">{earned ? "Earned" : "Not earned yet"}</span>
              </div>
            );
          })}
        </div>
        {best < 30 && (
          <p className="mt-2 text-[0.72rem] text-ink-dim">
            {(() => {
              const next = BADGES.find((b) => b.at > best);
              return next
                ? `${next.at - best} more ${next.at - best === 1 ? "day" : "days"} for “${next.label}”.`
                : null;
            })()}
          </p>
        )}
      </section>

      <nav className="rise mb-3 flex flex-col gap-2">
        {LINKS.map(({ href, label, hint, Icon }) => (
          <Link
            key={href}
            href={href}
            className="card flex items-center gap-3 px-4 py-3.5 transition-transform active:scale-[0.98]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <b className="block text-[0.88rem] font-extrabold text-ink">{label}</b>
              <span className="text-[0.72rem] text-ink-dim">{hint}</span>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-dim" />
          </Link>
        ))}
      </nav>

      <button type="button" onClick={logout} className="btn btn-quiet w-full">
        <LogoutIcon className="h-4 w-4" />
        Log out
      </button>
    </Screen>
  );
}
