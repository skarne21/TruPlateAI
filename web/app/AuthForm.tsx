"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Notice } from "./components/ui";

/** What the app actually promises, in three lines. Every calorie tracker
 *  claims accuracy; these are the three things ours can be held to. */
const PROMISES = [
  { emoji: "📷", text: "Photograph a meal — foods and portions identified for you" },
  { emoji: "🔬", text: "Macros from the USDA database, not an AI's guess" },
  { emoji: "🧠", text: "It remembers your corrections and gets them right next time" },
];

/** Shared login/signup form.
 *
 * One component rather than two near-identical pages: the only differences are
 * which Supabase call runs and where it lands afterwards.
 */
export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = isSignup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push(isSignup ? "/onboarding" : "/dashboard");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-10">
      {/* Two soft washes of the brand colours behind the card -- enough to stop
          the sign-in screen looking like a blank form. */}
      <div
        aria-hidden
        className="glow pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl"
      />
      <div
        aria-hidden
        className="glow pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-carbs/20 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="rise mb-7 text-center">
          <span className="pop mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-accent to-accent-2 text-3xl shadow-pop">
            🍽️
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">
            TruPlate<span className="gradient-text"> AI</span>
          </h1>
          <p className="mt-1 text-[0.85rem] text-ink-dim">
            {isSignup ? "Real macros, from a photo." : "Welcome back."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card card-lift rise px-5 py-6">
          <label htmlFor="email" className="mb-1.5 block text-[0.72rem] font-bold text-ink-dim">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field mb-4"
          />

          <label htmlFor="password" className="mb-1.5 block text-[0.72rem] font-bold text-ink-dim">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />

          {error && (
            <div className="mt-3">
              <Notice tone="warn">{error}</Notice>
            </div>
          )}

          <button type="submit" disabled={busy} className="btn btn-primary mt-5 w-full">
            {busy ? "…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        {isSignup && (
          <ul className="rise mt-5 flex flex-col gap-2.5">
            {PROMISES.map((p) => (
              <li key={p.text} className="flex items-start gap-2.5">
                <span className="text-base" aria-hidden>
                  {p.emoji}
                </span>
                <span className="text-[0.78rem] leading-snug text-ink-dim">{p.text}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 text-center text-[0.82rem] text-ink-dim">
          {isSignup ? "Already have an account? " : "New here? "}
          <Link href={isSignup ? "/login" : "/signup"} className="font-extrabold text-accent">
            {isSignup ? "Log in" : "Create one"}
          </Link>
        </p>
      </div>
    </main>
  );
}
