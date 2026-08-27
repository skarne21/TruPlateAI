"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "./icons";
import TabBar from "./TabBar";

/* ------------------------------------------------------------------ shell -- */

/** Every signed-in screen is this: a phone-width column on a warm ground,
 *  with room at the bottom for the tab bar so nothing hides behind it. */
export function Screen({
  children,
  tabs = true,
  className = "",
}: {
  children: React.ReactNode;
  tabs?: boolean;
  className?: string;
}) {
  return (
    <>
      {/* No bottom padding without the tab bar: screens that centre themselves
          use their own `min-h-screen`, and an extra 2.5rem under it is what
          gives a full-height screen a pointless scrollbar. */}
      <main className={`min-h-screen bg-bg ${tabs ? "pb-28" : ""}`}>
        <div className={`mx-auto w-full max-w-md px-4 ${className}`}>{children}</div>
      </main>
      {tabs && <TabBar />}
    </>
  );
}

/** Sticky screen header. `back` turns the title row into a way out, which
 *  matters on the screens that aren't tab destinations. */
export function TopBar({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="safe-top sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 bg-bg/85 px-4 pt-5 pb-3 backdrop-blur-xl">
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="btn btn-ghost h-10 w-10 min-h-0 shrink-0 p-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="truncate text-[0.8rem] text-ink-dim">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

/* ------------------------------------------------------------------ state -- */

/** A shimmering stand-in for content that is still loading.
 *
 * A skeleton beats a spinner because it shows the shape of what's coming --
 * the screen doesn't jump when the data lands. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function LoadingScreen() {
  return (
    <Screen>
      <div className="pt-16">
        <Skeleton className="mb-3 h-6 w-32" />
        <Skeleton className="mb-4 h-64 w-full rounded-2xl" />
        <div className="mb-4 grid grid-cols-3 gap-2.5">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </Screen>
  );
}

export function NeedsOnboarding() {
  return (
    <Screen tabs={false}>
      <div className="flex min-h-screen flex-col items-center justify-center text-center">
        <div className="pop mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-linear-to-br from-accent to-accent-2 text-4xl">
          👋
        </div>
        <h1 className="mb-1 text-2xl font-extrabold text-ink">One quick setup</h1>
        <p className="mb-6 max-w-xs text-sm text-ink-dim">
          We need your goal and a few numbers before any of this means anything.
        </p>
        <Link href="/onboarding" className="btn btn-primary w-full max-w-xs">
          Set up my targets
        </Link>
      </div>
    </Screen>
  );
}

/** Shown when a screen's initial load never arrived.
 *
 * Every screen here fetches in an effect and renders a skeleton until the data
 * lands. Without this, a failed request leaves the skeleton shimmering forever
 * -- the app looks like it is still trying when it has already given up. */
export function LoadFailed({ what = "this screen" }: { what?: string }) {
  return (
    <Screen>
      <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
        <span className="mb-3 text-3xl" aria-hidden>
          📡
        </span>
        <h1 className="mb-1 text-lg font-extrabold text-ink">Couldn&apos;t load {what}</h1>
        <p className="mb-6 max-w-xs text-[0.82rem] text-ink-dim">
          The server didn&apos;t answer. Your data is safe — nothing was lost.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn btn-primary w-full max-w-xs"
        >
          Try again
        </button>
      </div>
    </Screen>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "good" | "warn";
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-border bg-surface-2 text-ink-2",
    good: "border-good/35 bg-good/10 text-ink",
    warn: "border-warn/35 bg-warn/10 text-ink",
  }[tone];

  return (
    <p role={tone === "warn" ? "alert" : undefined} className={`rise rounded-xl border px-3.5 py-3 text-[0.8rem] font-medium ${styles}`}>
      {children}
    </p>
  );
}

/* ----------------------------------------------------------------- motion -- */

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up to its value.
 *
 * The count is the reward: watching 0 climb to 1,840 makes a total feel
 * earned in a way that printing it never does. Reduced-motion users get the
 * final number immediately. */
export function CountUp({
  value,
  duration = 750,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  // The displayed number is mirrored in a ref so a value that changes mid-flight
  // continues from where the digits actually are rather than jumping back.
  const shownRef = useRef(0);
  // Read once at mount: a media query result is not worth re-subscribing to
  // mid-animation, and this keeps the effect free of a synchronous setState.
  const [reduced] = useState(reducedMotion);

  useEffect(() => {
    if (reduced) return;
    const origin = shownRef.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast at first, settling at the end -- the arrival is
      // what should feel deliberate.
      const eased = 1 - Math.pow(1 - t, 3);
      shownRef.current = Math.round(origin + (value - origin) * eased);
      setShown(shownRef.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return (
    <span className={`tabular-nums ${className}`}>
      {(reduced ? value : shown).toLocaleString()}
    </span>
  );
}

/** A short buzz, where the device supports one. iOS Safari doesn't, and that
 *  is fine -- it's a garnish, never the feedback itself. */
export function haptic(pattern: number | number[] = 12) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator && !reducedMotion()) {
    navigator.vibrate(pattern);
  }
}

const CONFETTI_COLORS = [
  "var(--accent)",
  "var(--accent-2)",
  "var(--protein)",
  "var(--carbs)",
  "var(--fat)",
  "var(--good)",
];

/** A one-shot confetti burst from the middle of the screen.
 *
 * Thirty absolutely-positioned divs on one CSS keyframe. A physics library
 * for two seconds of celebration would be more code than the app's maths. */
export function Confetti({ pieces = 30 }: { pieces?: number }) {
  const [bits] = useState(() =>
    Array.from({ length: pieces }, (_, i) => {
      const angle = (i / pieces) * Math.PI * 2 + Math.random();
      const distance = 90 + Math.random() * 190;
      return {
        dx: `${Math.cos(angle) * distance}px`,
        dy: `${Math.sin(angle) * distance + 120}px`,
        rot: `${Math.random() * 720 - 360}deg`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: `${Math.random() * 120}ms`,
        size: 6 + Math.random() * 6,
      };
    })
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="absolute top-[38%] left-1/2 rounded-[2px]"
          style={
            {
              width: b.size,
              height: b.size * 1.6,
              background: b.color,
              animation: `tp-confetti 1.3s cubic-bezier(.2,.7,.4,1) ${b.delay} forwards`,
              "--dx": b.dx,
              "--dy": b.dy,
              "--rot": b.rot,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
