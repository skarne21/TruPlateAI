# Phase 3 (part 1) — Adaptive Targets

**Date:** 2026-08-09
**Status:** Design, ready to implement
**Scope:** the adaptive TDEE engine only. Meal memory and the recipe corpus follow; Foodie last, since it depends on both.

**Goal:** stop trusting a population-average formula once the user has produced better evidence about their own body.

**Exit criteria:** feed three simulated weeks of weigh-ins and logged intake, and the target moves in the right direction by a defensible amount; `pytest` green.

---

## 1. Why this exists

Mifflin-St Jeor gives a starting estimate from height, weight, age and sex. It is a population average, and individual TDEE varies by roughly ±200–300 kcal around it for reasons a formula cannot see — NEAT, gut absorption, activity that doesn't match a dropdown.

After a couple of weeks the user has generated far better evidence: what they actually ate, and what their weight actually did. Energy balance says those two facts imply their real expenditure. This phase computes it.

**Fully deterministic Python, no LLM anywhere** (`CLAUDE.md` invariant #10). This is the part of the project that must be provably correct, and it is the piece most worth being able to defend line by line in an interview.

---

## 2. Sequencing, and why adaptive targets goes first

Phase 3 contains three independent bodies of work:

| Workstream | Depends on | Blocked by Gemini quota? |
|---|---|---|
| **Adaptive targets** | nothing | **No** |
| Meal memory (pgvector) | embeddings API + `vector` extension | Yes |
| Recipe corpus → Foodie | meal-memory infrastructure | Yes |

Adaptive targets is picked first because it is the highest-value piece, the only one that cannot be stalled by the free tier's daily cap (which ran out twice during Phase 2), and it is demoable on its own.

---

## 3. The maths

### Smoothing weigh-ins

Daily weight swings several pounds on water, salt and gut contents. Reading a trend off raw weigh-ins produces nonsense, so an exponential moving average smooths them:

```
ema[0] = w[0]
ema[t] = α·w[t] + (1−α)·ema[t−1]        α = 0.3
```

α = 0.3 weights recent weigh-ins enough to track a real trend within about a week while ignoring a single salty meal. Higher α is jumpy, lower α lags a genuine change.

### Observed TDEE

```
observed_TDEE = mean_daily_intake − (Δema_lb × 3500 / days)
```

Sign check, because it is easy to get backwards: eat 2500 kcal/day and *gain*, so Δema is positive, and observed TDEE comes out **below** 2500 — correct, they were in surplus. Lose weight and Δema is negative, so observed comes out **above** intake — correct, they burned more than they ate. Both directions get a test.

3500 kcal per pound of body mass is the standard approximation.

### Blending formula into observed

Two weeks of data is enough to be suggestive, not enough to be trusted outright — a single bad week of logging would swing it. So the estimate ramps over weeks 2–4:

```
weight = clamp((days − 14) / 14, 0, 1)
estimate = (1 − weight)·formula_TDEE + weight·observed_TDEE
```

Under 14 days: formula only. At 28 days: fully observed. The engine returns nothing at all before 14 days rather than adjusting on noise.

### The new target, and the cap

```
new_kcal = estimate_TDEE + target_rate_lb_per_week × 500
```

500 kcal/day ≈ 1 lb/week, the same constant `targets.py` already uses — the adaptive path must not disagree with the formula path about basic arithmetic.

Changes are capped at **±150 kcal per adjustment**. Without a cap, one anomalous week (illness, a holiday, a stretch of unlogged days) could swing the target several hundred calories and the user would lose all confidence in it. Slow and stable beats fast and jumpy for a number someone plans meals around.

### The adherence guard

If fewer than **70%** of days in the window were logged, no adjustment is made at all. Observed TDEE is computed from logged intake; if half the days are missing, mean intake is understated, observed TDEE comes out too low, and the engine would *cut* calories from someone who simply forgot to log. That is the single most dangerous failure mode here, so it fails closed and says why.

---

## 4. Data model — migration `0004_adaptive.sql`

```sql
weights(
  id uuid pk, user_id uuid not null references auth.users on delete cascade,
  weight_kg numeric not null,
  measured_on date not null,          -- client's local date, as elsewhere
  created_at timestamptz default now(),
  unique (user_id, measured_on)       -- one weigh-in per day; re-weighing replaces
)

targets(
  id uuid pk, user_id uuid not null references auth.users on delete cascade,
  effective_date date not null,
  kcal numeric not null, protein_g numeric not null,
  source text check (source in ('formula','adaptive')),
  explanation text not null,          -- plain language, shown to the user
  created_at timestamptz default now()
)
```

RLS on both, all four verbs, `auth.uid() = user_id` — same pattern as every other table.

**`targets` is history, never updated in place.** Every change is a new row with the reason it happened, so the user can always see why their number moved and the dashboard can chart it. A target that silently changes is one nobody trusts.

**Weights are never overwritten either** (bar re-weighing on the same day), because the whole engine depends on the full series.

---

## 5. Endpoints

| Route | Purpose |
|---|---|
| `POST /weights` | Record a weigh-in, then run the adaptive check. |
| `GET /weights` | The series plus its EMA, for the trend chart. |
| `GET /targets/current` | Latest target — formula or adaptive. |
| `GET /targets/history` | Every change with its explanation. |

`GET /profile` keeps returning the formula result so nothing already built breaks; the dashboard moves to `/targets/current` so it shows the adaptive number once one exists.

---

## 6. Explanations are part of the feature

Every adaptive change stores plain language:

> *"You're gaining about 0.2 lb/week against a target of 0.5, and your logged intake suggests you burn about 2,740 kcal/day. Calories go up 120 to 2,990."*

Not decoration. A number that moves without explanation looks like a bug, and the user is meant to be able to sanity-check the engine rather than obey it.

---

## 7. Testing

`api/tests/test_adaptive.py`, all pure functions, no mocks needed:

- EMA: first value passes through; a single spike moves the average by roughly α; a sustained change is tracked within about a week.
- Observed TDEE: both directions (gaining → below intake, losing → above), and weight-stable → equals intake.
- Blending: formula-only under 14 days, fully observed at 28, halfway at 21.
- Cap: a swing that would move the target 400 kcal moves it 150.
- Adherence: 4-of-7 days logged produces no adjustment and an explanation saying so.
- End to end: three simulated weeks produce a defensible target change (the exit criterion).

---

## 8. Out of scope here

Meal memory, recipe corpus, Foodie, restaurant search. Also the weigh-in *nudge* (reminding the user to weigh in) — that needs notification plumbing that doesn't exist, and the engine works whenever weigh-ins happen to arrive.
