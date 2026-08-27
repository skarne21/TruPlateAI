"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, requireSession } from "@/lib/api";
import { localDate } from "@/lib/day";
import TabBar from "./components/TabBar";
import { CoachIcon, FoodieIcon, SendIcon } from "./components/icons";
import { LoadFailed, LoadingScreen, NeedsOnboarding, Notice } from "./components/ui";

type Message = { role: "user" | "assistant"; content: string };
type Assistant = "coach" | "foodie";

const COPY: Record<
  Assistant,
  {
    title: string;
    blurb: string;
    empty: string;
    suggestions: string[];
    Icon: (p: { className?: string }) => React.ReactElement;
    accent: string;
    tint: string;
  }
> = {
  coach: {
    title: "Coach",
    blurb: "Knows your logs and your targets",
    empty:
      "Ask about your intake, your targets, or how you're tracking. Every answer comes from what you've actually logged — not from generic advice.",
    suggestions: [
      "How am I doing on protein this week?",
      "Why am I not gaining weight?",
      "What should I change tomorrow?",
    ],
    Icon: CoachIcon,
    accent: "text-accent",
    tint: "bg-accent/12",
  },
  foodie: {
    title: "Foodie",
    blurb: "Finds food that fits what's left today",
    empty:
      "Ask what to cook or eat next. Suggestions come from real recipes, hard-filtered in code against your allergies and exclusions.",
    suggestions: [
      "What should I eat tonight?",
      "Something high protein and quick",
      "Cheap dinner with what's left today",
    ],
    Icon: FoodieIcon,
    accent: "text-carbs",
    tint: "bg-carbs/12",
  },
};

/** Just enough markdown for what the assistants actually emit: bold runs and
 *  dashed bullets. A markdown library would be a dependency and a bundle for
 *  two syntaxes -- and building React nodes rather than HTML means there is no
 *  injection surface at all. */
function formatted(text: string) {
  return text.split("\n").map((line, i) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    const body = bullet ? line.replace(/^\s*[-*]\s+/, "") : line;
    const parts = body.split("**").map((part, j) =>
      j % 2 === 1 ? <strong key={j}>{part}</strong> : part
    );
    if (bullet) {
      return (
        <span key={i} className="flex gap-2">
          <span aria-hidden className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
          <span>{parts}</span>
        </span>
      );
    }
    return <span key={i} className="block">{parts.length === 1 && body === "" ? " " : parts}</span>;
  });
}

export default function AssistantChat({ assistant }: { assistant: Assistant }) {
  const copy = COPY[assistant];
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-profile" | "failed">("loading");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const session = await requireSession(router);
      if (cancelled || !session) return;

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
    load().catch(() => setStatus("failed"));
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
    setMessages((prev) => [
      ...prev,
      { role: "user", content: message },
      { role: "assistant", content: "" },
    ]);

    try {
      const res = await apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({ message, today: localDate(), assistant }),
      });
      if (!res.ok || !res.body)
        throw new Error(`${copy.title} isn't reachable right now (${res.status})`);

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

  if (status === "loading") return <LoadingScreen />;
  if (status === "no-profile") return <NeedsOnboarding />;
  if (status === "failed") return <LoadFailed what={`your ${copy.title} chat`} />;

  const Icon = copy.Icon;

  return (
    <>
      {/* A chat is the one screen that has to own the full viewport height:
          the composer stays put and only the transcript scrolls. */}
      <div className="pb-tabbar flex h-[100dvh] flex-col bg-bg">
        <header className="safe-top flex shrink-0 items-center gap-3 border-b border-border bg-bg/85 px-4 pt-4 pb-3 backdrop-blur-xl">
          <span className={`flex h-11 w-11 items-center justify-center rounded-full ${copy.tint} ${copy.accent}`}>
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg leading-tight font-extrabold text-ink">{copy.title}</h1>
            <p className="truncate text-[0.75rem] text-ink-dim">{copy.blurb}</p>
          </div>
        </header>

        <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="rise flex flex-col items-center pt-6 text-center">
              <span
                className={`pop mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${copy.tint} ${copy.accent}`}
              >
                <Icon className="h-8 w-8" />
              </span>
              <p className="mb-5 max-w-xs text-[0.85rem] text-ink-dim">{copy.empty}</p>
              <div className="flex w-full flex-col gap-2">
                {copy.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="choice px-4 py-3 text-left text-[0.85rem] font-semibold text-ink"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {messages.map((message, index) => {
              const mine = message.role === "user";
              const waiting = !message.content && streaming && index === messages.length - 1;

              return (
                <div
                  key={index}
                  className={`rise max-w-[85%] px-4 py-2.5 text-[0.88rem] leading-relaxed ${
                    mine
                      ? "self-end rounded-[1.15rem] rounded-br-md bg-linear-to-br from-accent to-accent-2 text-on-accent"
                      : "card self-start rounded-[1.15rem] rounded-bl-md text-ink"
                  }`}
                >
                  {waiting ? (
                    <span className="typing flex items-center gap-1 py-1" aria-label="Thinking">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink-dim" />
                      <span className="h-1.5 w-1.5 rounded-full bg-ink-dim" />
                      <span className="h-1.5 w-1.5 rounded-full bg-ink-dim" />
                    </span>
                  ) : (
                    formatted(message.content)
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-3">
              <Notice tone="warn">{error}</Notice>
            </div>
          )}
          <div ref={bottom} className="h-2" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="mx-auto w-full max-w-md shrink-0 px-4 pb-3"
        >
          <div className="flex items-end gap-2 rounded-full border border-border bg-surface p-1.5 shadow-md">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Ask ${copy.title}…`}
              aria-label={`Message ${copy.title}`}
              className="flex-1 bg-transparent px-3 py-2 text-[0.9rem] outline-none placeholder:text-ink-dim"
            />
            <button
              type="submit"
              disabled={streaming || !draft.trim()}
              aria-label="Send"
              className="btn btn-primary h-11 w-11 min-h-0 shrink-0 p-0"
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </div>
        </form>
      </div>
      <TabBar />
    </>
  );
}
