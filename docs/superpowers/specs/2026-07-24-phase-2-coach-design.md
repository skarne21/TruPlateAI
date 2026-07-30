# Phase 2 (part 1) — The Coach

**Date:** 2026-07-24
**Status:** Design, ready to implement
**Scope decision:** build the chat foundation once, ship **only the Coach**. Foodie and voice reuse the same machinery afterwards.

**Goal:** a conversation that already knows your profile, today's totals and your recent history, answers from real logged data rather than recall, and persists so you never re-explain yourself.

**Exit criteria:** ask "how am I doing on protein this week?" and get an answer containing numbers that match the database; reload the page and the conversation is still there; `pytest` green.

---

## 1. Measured facts that shaped this design

Verified against `google-genai` 2.10.0 and the live API before designing, the same way §1 of the Phase 1 spec was:

**Automatic function calling works with streaming.** Passing plain Python callables as `tools=[...]` makes the SDK run the whole call loop itself — it invokes the function, feeds the result back, and streams the final answer. A tool-using turn still streamed in 9 chunks, so tool use does *not* collapse streaming. (An earlier single-chunk reading was simply a short answer, not a limitation.)

**Thinking is the dominant latency cost, and it is not worth paying here.**

| Config | First token | Total |
|---|---|---|
| thinking on (SDK default) | 7.70 s | 9.26 s |
| `thinking_budget=0` | **0.82 s** | 2.75 s |

Chat is judged on time-to-first-token, and 7.7 seconds of silence reads as broken. The Coach is not doing deep reasoning — the numbers arrive pre-computed from SQL and tools, so its job is interpretation and phrasing. **Chat sets `thinking_budget=0`; the vision pipeline keeps thinking on**, because there accuracy matters more than latency and the user is already watching a spinner.

This is a knob, not a law: if answer quality proves thin, raising the budget is a one-line change.

---

## 2. Grounding: SQL summary injected, tools for the rest

Every turn injects a compact, SQL-computed summary into the system instruction:

- today's consumed kcal/protein/carbs/fat and what remains against target
- the last 7 days: average intake, days logged, average protein
- the user's profile (goal, rate, cuisines, exclusions)

So the most common questions — "how many calories left?", "am I hitting protein?" — are answerable with zero extra round-trips, and the model can never miscount them because it never counts them.

For anything deeper, two tools:

```python
get_logs(days: int) -> dict        # per-day totals + meal names over a range
usda_lookup(food: str) -> dict     # per-100g macros for a food not yet logged
```

**Both tools are closures over the request's RLS-scoped Supabase client.** They physically cannot query another user's rows — the tool has no parameter for whose data to fetch, and the client it closes over is authenticated as the caller. That is the whole security model for tool calling, and it falls out of the Phase 0 decision to authenticate the backend *as the user* rather than as a service role.

`usda_lookup` reuses [api/usda.py](../../../api/usda.py) unchanged.

---

## 3. Data model — migration `0003_chat.sql`

```sql
conversations(
  id uuid pk, user_id uuid not null references auth.users on delete cascade,
  assistant text check (assistant in ('coach','foodie')),   -- foodie unused in this phase
  created_at timestamptz default now()
)

messages(
  id uuid pk,
  conversation_id uuid not null references conversations on delete cascade,
  user_id uuid not null,          -- denormalized, same reason as meal_items
  role text check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
)
```

RLS on both, `auth.uid() = user_id`, all four verbs — identical pattern to `meals`/`meal_items`.

One conversation per user per assistant for now: the Coach is an ongoing relationship, not a series of disposable threads. Multiple named threads are a later nicety and the schema already allows them.

**History is capped at the last 20 messages** resent per turn. Unbounded history is precisely the failure mode that makes a plain chatbot useless as a tracker — cost and latency grow forever and the oldest turns silently fall out anyway. Capping it explicitly, with the durable facts injected from SQL instead, means the Coach's knowledge of your history does *not* depend on what fits in a context window.

---

## 4. Endpoints

| Route | Purpose |
|---|---|
| `POST /chat` | Streams the reply as newline-delimited JSON; persists both sides afterwards. |
| `GET /chat/history` | The stored conversation, for rendering on page load. |

**Transport: newline-delimited JSON over `StreamingResponse`**, not Server-Sent Events. SSE buys reconnection semantics we do not want (a half-finished LLM reply should not silently resume) and imposes framing rules that complicate sending a final metadata object. NDJSON over `fetch` + `ReadableStream` is a dozen lines on each side.

Each line is `{"type": "chunk", "text": ...}` while streaming, then a final `{"type": "done", "message_id": ...}`. Errors mid-stream emit `{"type": "error", "message": ...}` — the connection is already open with a 200, so a failure has to travel *in* the stream, not as a status code. The UI shows the partial answer plus a visible error rather than a blank box.

**Persistence happens after the stream completes**, both sides written together. A reply abandoned midway is not persisted, so history never contains half a sentence attributed to the Coach.

---

## 5. Guardrails

The system prompt establishes: nutrition guidance only; medical questions (medication, diagnosed conditions, symptoms) get a brief "worth asking a professional" deferral rather than an answer; no endorsement of extreme deficits.

**Being honest about strength:** this is a prompt-level guardrail, and prompt-level guardrails are advisory. It is genuinely weaker than the exclusion filtering planned for Foodie, which will be enforced in code after generation. The Coach mostly *talks* rather than *recommends specific foods*, so the exposure is smaller — but this is a real difference in kind and should not be described as if the two were equivalent. A refusal test lives in the suite so at least the common case is checked.

---

## 6. Frontend

New `/coach` route in the established design system. Loads history on mount, streams replies token by token, keeps the input available. The bottom-nav "Coach" item goes from inert to a real link — the third of five now live.

Empty state matters here: with no meals logged the Coach has nothing to work with, so it says so and links to `/log` rather than inventing encouragement.

---

## 7. Testing

- `test_chat_context.py` — the SQL summary builder: totals for a day, 7-day averages, the zero-meals case, and that a user's summary never includes another user's rows.
- `test_chat_tools.py` — `get_logs` returns real per-day rows and is bound to one user; `usda_lookup` reuses the USDA mapping.
- `test_chat_stream.py` — NDJSON framing, the final `done` line, and that a mid-stream failure emits an `error` line rather than truncating silently (Gemini mocked).
- A guardrail test asserting a medical question produces a deferral.

Plus the usual: drive it in a browser, and verify a second user cannot read the first's conversation.

---

## 8. Explicitly out of scope

Foodie, voice input, recipe RAG, restaurant search, meal memory, adaptive targets. Foodie in particular is deliberately deferred: its best features depend on the embedded recipe corpus that Phase 3 builds, so shipping it now would mean shipping a worse version of it twice.
