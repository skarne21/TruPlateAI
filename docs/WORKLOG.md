# TruPlate AI — Work Log

A running record of what has been built, changed, and broken. Companion to
[how-it-works.md](how-it-works.md), which explains how the finished thing
works; this file records *how it got there*.

**Keeping it updated:** add an entry whenever you commit. Git already records
which lines changed — the value here is the part git can't hold: what broke,
what turned out to be wrong, and why a decision went the way it did. If an
entry doesn't say something a `git diff` wouldn't, it isn't earning its place.

---

## Current state — 2026-08-09

| | |
|---|---|
| Phase | 3 of 5 (adaptive targets done; meal memory and recipe corpus remain) |
| Tests | **109 passing**, all offline (no network, no credentials) |
| API routes | 14 |
| Database tables | 8, all with Row Level Security |
| Migrations | 4, all applied |
| Deployed | **No** — runs locally only |

### API modules

| File | Lines | Purpose |
|---|---|---|
| `api/main.py` | 31 | App setup, CORS, router mounting |
| `api/deps.py` | 81 | JWT verification, per-token Supabase client |
| `api/targets.py` | 79 | Mifflin-St Jeor formula targets |
| `api/adaptive.py` | 204 | Adaptive TDEE engine (EMA, observed burn, caps) |
| `api/usda.py` | 130 | USDA search, match selection, macro scaling |
| `api/vision.py` | 281 | Meal analysis schema + Gemini calls |
| `api/analysis.py` | 258 | USDA pricing, clarifying-answer arithmetic |
| `api/chat.py` | 254 | Coach context, tools, streaming |
| `api/transcribe.py` | 110 | Voice transcribe-and-clean |
| `api/routes/*.py` | 716 | profile, analyze, meals, chat, weights |

### Frontend routes

`/` (redirect) · `/login` · `/signup` · `/onboarding` · `/dashboard` ·
`/log` · `/coach` · `/weight`

### Tests

| File | Count | Covers |
|---|---|---|
| `test_adaptive.py` | 24 | EMA, observed TDEE, blending, caps, adherence, cadence |
| `test_analysis.py` | 15 | USDA pricing, fallbacks, clarifying answers |
| `test_vision.py` | 15 | Schema validation, retry, multi-image, fat photo |
| `test_usda_mapping.py` | 11 | Match selection, scaling, energy sanity check |
| `test_chat_tools.py` | 10 | `get_logs` scoping, food names, embedded query |
| `test_transcribe.py` | 9 | Cleanup prompt, vocabulary priming, no invention |
| `test_targets.py` | 7 | BMR both sexes, activity, goals, safe-rate cap |
| `test_chat_context.py` | 7 | SQL summary, averages, history cap |
| `test_chat_route.py` | 6 | `/chat` wiring, persistence, auth |
| `test_chat_stream.py` | 5 | NDJSON framing, mid-stream failure |

---

## Phase 0 — Foundation (2026-07-06 → 07-24)

Repo, both apps talking, auth, and the formula targets engine.

| Commit | What changed |
|---|---|
| `6132b67` | Initial commit |
| `c64eb03` | Renamed macrosnap → TruPlate AI |
| `228df7b` | **+** `api/main.py`, `requirements.txt`, `.env.example` — FastAPI + CORS |
| `493a58e` | **+** `targets.py`, `test_targets.py` (7 tests) — Mifflin-St Jeor, TDD |
| `87802b7` | **+** `scripts/test_gemini.py`, `scripts/test_usda.py` — API sanity checks |
| `f4982af` | **+** `0001_profiles.sql` — profiles table with RLS |
| `dc013b7` | **+** `deps.py`, `pytest.ini`; `main.py` gains `/profile` |
| `e6d7481` | **fix** photo path resolved against script location, not cwd |
| `8685eee` | **+** Next.js scaffold, `.gitignore`, design tokens |
| `236cb85` | **+** `login`, `signup`, `lib/supabase/*`, `proxy.ts` |
| `72d5a73` | **fix** `gym_days` silently discarded on every save |
| `a5ca5e9` | **+** onboarding wizard, `ChipGroup`, `lib/units.ts` |
| `b662af1` | **fix** auth/profile errors dropping CORS headers |
| `d033d50` | **+** dashboard showing persisted targets |
| `6dbbdf1` | **+** README |

**Bugs found:** `gym_days` dropped silently (Pydantic ignores undeclared
fields); two wrong expected values in the targets tests; env vars read before
`load_dotenv()`; pytest collecting a sanity script as a test; relative photo
path; first phantom CORS error; a React race on fast logout→login.

---

## Phase 1 — Core loop (2026-07-24)

Photo/text → Gemini → USDA → clarifying questions → confirm → logged.

| Commit | What changed |
|---|---|
| `48b0725` | **+** `how-it-works.md`, `mockup.html`, Phase 0 plan, Phase 1 spec |
| `3fe5dba` | **~** spec: multi-photo meals, photo-answered fat questions |
| `0a3ba44` | **+** `usda.py`, `vision.py`, `analysis.py` + 3 test files (41 tests), USDA fixtures |
| `2bfc0ed` | **+** `routes/` package (analyze, meals, profile), `0002_meals.sql`; `main.py` shrinks 44→6 lines |
| `39fed4b` | **+** `/log` UI, `ReviewStep`, `AddItem`, `lib/api.ts`, `lib/image.ts` |
| `a1d4d92` | **fix** USDA energy sanity check (the banana bug) |
| `b1b5868` | **fix** fat questions worded in Python to match their options |
| `abd9fe2` | **fix** Gemini/USDA outages no longer surface as phantom CORS errors |
| `976bfb9` | **~** walkthrough brought up to date |
| `537294d` | **fix** four review bugs; **+** shared `AuthForm` |
| `cd47d73` | **~** walkthrough records the auth-page cleanup |

**Design decision reversed before coding:** the plan was to prefer USDA
Foundation/SR Legacy data types. Live testing showed those are *raw
ingredients* and were wrong on all 8 test foods — `sambar lentil vegetable
stew` matched **"Chicken, stewing"**. Switched to Survey (FNDDS), which covers
prepared dishes.

---

## Phase 2 — Coach and voice (2026-07-30 → 08-06)

| Commit | What changed |
|---|---|
| `651af92` | **+** Phase 2 Coach design spec |
| `8167531` | **+** `chat.py`, `routes/chat.py`, `0003_chat.sql`, `conftest.py` + 3 test files (22 tests) |
| `59f5884` | **+** `/coach` UI with token-by-token streaming |
| `14ee81d` | **+** `test_chat_route.py` (6 wiring tests through real FastAPI) |
| `2a6983a` | **perf** local JWT verification + per-token client cache |
| `14c88e4` | **+** `transcribe.py`, `VoiceButton.tsx`, `test_transcribe.py` (9 tests) |

**Measured before designing:** automatic function calling survives streaming
(9 chunks on a tool-using turn), and thinking costs 7.70s to first token
against 0.82s with `thinking_budget=0`. Chat disables thinking; the vision
pipeline keeps it.

**Foodie deliberately not built** — its useful features need the recipe corpus
that Phase 3 builds, so shipping it now means shipping it twice.

---

## Phase 3 — Adaptive targets (2026-08-09, in progress)

| Commit | What changed |
|---|---|
| `23f6590` | **+** `adaptive.py`, `routes/weights.py`, `0004_adaptive.sql`, `test_adaptive.py` (21 tests), design spec |
| `e9bdba5` | **+** `/weight` page, `WeightChart.tsx`; dashboard reads stored targets |
| `531a1f9` | **fix** adjustments are weekly, not per weigh-in (+3 tests) |

**Verified end to end** against four simulated weeks: observed TDEE converged
to 2721 against a true 2700, and the target moved 2875 → 2953 where ideal was
2950.

**Remaining in Phase 3:** meal memory (pgvector embeddings, one-tap re-log),
recipe corpus, then Foodie.

---

## Bug ledger

Every bug that reached committed code, with what actually caused it. The
pattern worth noticing: **almost none would have failed a typecheck, and
several passed unit tests.**

| # | Bug | Root cause | Caught by |
|---|---|---|---|
| 1 | `gym_days` never saved | Field undeclared on the Pydantic model, which drops unknown fields silently | Checking the database after a UI test |
| 2 | Two targets tests wrong | Expected values used raw BMR instead of BMR × activity | TDD — test failed for the wrong reason |
| 3 | API crashed on startup | `deps.py` read env vars at import, before `load_dotenv()` ran | Running the server |
| 4 | pytest crashed | A sanity script matched `test_*.py` and got collected | Running pytest |
| 5 | `FileNotFoundError` | Relative path resolved against cwd, not the script | Running from a different folder |
| 6, 7 | Two "CORS errors" | Unhandled exceptions escaping past CORS middleware | Browser testing |
| 8 | Stale dashboard data | `useEffect` had no cancellation guard on a fast logout→login | Browser testing |
| 9 | **Banana logged 830 kcal (4× too high)** | USDA ranks "Bananas, dehydrated" above "Bananas, raw" for the bare query `banana` | First real photo through the pipeline |
| 10 | Question didn't match its answers | "How was the sambar prepared?" above a list of amounts | Reading real output |
| 11 | Third "CORS error" | Gemini 503 escaping unhandled | Browser testing |
| 12 | "Found no fat detected in your photo" | `fat_name` had no way to express "none", so the model wrote its refusal into the name | Browser testing |
| 13 | Added items counted as 0 carbs/fat | `/usda/search` returned only kcal and protein | Code review |
| 14 | Photo object URLs leaked | Cleanup closed over the first render's empty array — and an `eslint-disable` was hiding it | Code review |
| 15 | Site root was a debug screen | Phase 0 health readout never replaced | Code review |
| 16 | Auth cost 1475ms per request | A whole Supabase client (SSL context and all) built per request | Profiling |
| 17 | **Target moved up to 1050 kcal/week** | Cap was per *adjustment*, engine ran per *weigh-in* | Four-week simulation |

### Three worth reading twice

**#9, the banana.** My earlier evidence used descriptive multi-word queries
("idli steamed rice cake") where USDA ranks well. A bare `banana` doesn't.
The model's own estimate was correct, so it now acts as a sanity check on the
match — but ranking stays primary, because ranking by calorie agreement alone
picked "Crepe, chocolate filled" over "Dosa, with filling".

**#16, the auth cost.** I first "fixed" this by consolidating database
queries, which barely helped. Profiling showed the queries were 50–130ms and
the real cost was `httpx` building an SSL context (596ms) per client. Worse,
my "2.1s per request" measurement was mostly a Windows `localhost` → IPv6
fallback in my own test harness. **Two wrong diagnoses before measuring
properly.**

**#17, the weekly cap.** The rule is "150 kcal per week"; the code was "150
kcal per weigh-in". Unit tests call the engine once, so the bug only exists
in a *sequence*. Found by simulating 28 days: 14 recorded changes where there
should have been about 4.

---

## Deferred, with reasons

| Thing | Why not yet |
|---|---|
| Foodie assistant | Needs the recipe corpus; shipping now means shipping twice |
| Meal memory | Next up |
| Deployment | Requested after building completes |
| Weigh-in reminders | Needs notification plumbing; the engine works whenever weigh-ins arrive |
| Rate limiting | Phase 4 |
| Eval suite | Phase 4 — needs a weighed ground-truth photo set |

## Known limitations

- **Portion estimates are ±20–30%.** Inherent to photo estimation.
- **USDA has real gaps.** No *poha*, so it matches a groundcherry entry
  sharing the word, and the calorie check can't catch it because the wrong
  answer is calorically plausible. Mitigation is showing the matched
  description; a per-user alias table is the fix.
- **Gemini free tier ran out twice mid-session.** A real constraint on daily
  use and a bigger one for Phase 4 evals.
- **Supabase free tier auto-pauses.** The project has slept twice; a paused
  project means a dead link.
- **Nothing verifies a page *looks* right.** Every visual bug here was found
  by a human looking at a screenshot.
