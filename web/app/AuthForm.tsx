"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-xs font-bold tracking-widest text-accent uppercase">TruPlate AI</p>
        <h1 className="mb-1 text-2xl font-extrabold text-ink">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mb-6 text-sm text-ink-dim">
          {isSignup
            ? "Photograph a meal, get real macros from the USDA database."
            : "Log in to pick up where you left off."}
        </p>

        <form onSubmit={handleSubmit} className="border border-border bg-surface p-6">
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-ink-dim">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full border border-border bg-surface p-3 text-sm text-ink"
          />

          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-ink-dim">
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
            className="w-full border border-border bg-surface p-3 text-sm text-ink"
          />

          {error && <p className="mt-3 text-sm font-semibold text-warn">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full bg-linear-to-br from-accent to-accent-2 px-4 py-3 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
          >
            {busy ? "..." : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-dim">
          {isSignup ? "Already have an account? " : "New here? "}
          <Link
            href={isSignup ? "/login" : "/signup"}
            className="font-bold text-accent underline underline-offset-2"
          >
            {isSignup ? "Log in" : "Create one"}
          </Link>
        </p>
      </div>
    </main>
  );
}
