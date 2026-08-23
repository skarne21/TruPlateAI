"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

type Message = { role: "user" | "assistant"; content: string };

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

type Assistant = "coach" | "foodie";

const COPY: Record<Assistant, { title: string; blurb: string; empty: string; suggestions: string[] }> = {
  coach: {
    title: "Coach",
    blurb: "Knows your logs and your targets.",
    empty: "Ask about your intake, your targets, or how you're tracking. Answers come from what you've actually logged.",
    suggestions: [
      "How am I doing on protein this week?",
      "Why am I not gaining weight?",
      "What should I change tomorrow?",
    ],
  },
  foodie: {
    title: "Foodie",
    blurb: "Suggests food that fits what's left today.",
    empty: "Ask what to cook or eat next. Suggestions come from real recipes, filtered to what you can safely eat.",
    suggestions: [
      "What should I eat tonight?",
      "Something high protein and quick",
      "Cheap dinner with what's left today",
    ],
  },
};

export default function AssistantChat({ assistant }: { assistant: Assistant }) {
  const copy = COPY[assistant];
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-profile">("loading");
  const bottom = useRef<HTMLDivElement>(null);

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
      const res = await apiFetch(`/chat/history?assistant=${assistant}`);
      if (cancelled) return;
      if (res.status === 404) {
        setStatus("no-profile");
        return;
      }
      if (res.ok) setMessages(await res.json());
      if (cancelled) return;
      setStatus("ready");
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router, assistant]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;

    setDraft("");
    setError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: "" }]);

    try {
      const res = await apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({ message, today: localDate(), assistant }),
      });
      if (!res.ok || !res.body) throw new Error(`The Coach isn't reachable (${res.status})`);

      // Newline-delimited JSON: one object per line. A chunk can split across
      // reads, so anything after the last newline is held back for next time.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "chunk") {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: "assistant",
                content: next[next.length - 1].content + event.text,
              };
              return next;
            });
          } else if (event.type === "error") {
            // Arrives inside a 200 response, so it can't be caught by status.
            setError(event.message);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setStreaming(false);
    }
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
          <p className="mb-4 text-sm text-ink-dim">Finish onboarding first.</p>
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

  return (
    <main className="flex min-h-screen justify-center bg-bg px-4 py-10">
      <div className="flex w-full max-w-md flex-col">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest text-accent uppercase">{copy.title}</p>
            <p className="text-sm text-ink-dim">{copy.blurb}</p>
          </div>
          <Link href="/dashboard" className="text-xs font-bold text-ink-dim underline underline-offset-2">
            Back
          </Link>
        </div>

        <div className="mb-3 flex flex-1 flex-col gap-2.5">
          {messages.length === 0 && (
            <div className="border border-border bg-surface p-5">
              <p className="mb-3 text-sm text-ink-dim">{copy.empty}</p>
              <div className="flex flex-col gap-2">
                {copy.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="border border-border p-2.5 text-left text-sm font-semibold text-ink hover:border-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "user"
                  ? "self-end border border-accent bg-accent/10 px-3.5 py-2.5 text-sm text-ink"
                  : "border border-border bg-surface px-3.5 py-2.5 text-sm whitespace-pre-wrap text-ink"
              }
            >
              {message.content ||
                (streaming && index === messages.length - 1 ? (
                  <span className="text-ink-dim">Thinking...</span>
                ) : null)}
            </div>
          ))}

          {error && (
            <p className="border border-warn/40 bg-warn/10 p-3 text-xs font-semibold text-ink">
              {error}
            </p>
          )}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="sticky bottom-4 flex gap-2 border border-border bg-surface p-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Ask ${copy.title}...`}
            className="flex-1 border border-border bg-surface px-3 py-2.5 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={streaming || !draft.trim()}
            className="bg-linear-to-br from-accent to-accent-2 px-4 py-2.5 text-sm font-extrabold text-[#1a1006] disabled:opacity-40"
          >
            {streaming ? "..." : "Send"}
          </button>
        </form>
      </div>
    </main>
  );
}
