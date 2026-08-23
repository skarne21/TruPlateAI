# Phase 3 (part 3) — Recipe corpus and the Foodie assistant

**Date:** 2026-08-11
**Status:** Design, ready to implement

**Goal:** ask "what should I eat tonight?" and get real recipes that fit the
calories you have left, the cuisines you eat, and — enforced in code — your
allergies.

**Exit criteria:** Foodie suggests recipes from the corpus that fit remaining
macros; a recipe containing an excluded ingredient is never suggested, even
when the model is explicitly asked for it; `pytest` green.

---

## 1. Where recipes come from

There's no recipe dataset to hand, so the corpus is generated: **the model
writes the recipe, USDA prices it.**

- Gemini produces title, cuisine, cost level, time, steps, and ingredients
  **with gram weights and a `usda_query` each** (verified — it does this
  reliably under a schema).
- Every ingredient is then looked up in USDA and the recipe's macros are summed
  from real per-100g data.

So the *prose* is invented and the *numbers* are not — the same split the meal
pipeline already uses (`CLAUDE.md` invariant #1). A recipe whose ingredients
can't be priced is discarded rather than published with guessed macros.

Built once by a script into a shared table, not per-user and not at runtime.

---

## 2. Allergen filtering is the safety-critical part

`CLAUDE.md` invariant #5: exclusions are enforced **in code**, never by the
model. This is the one place in the project where getting it wrong could hurt
someone, so it gets belt and braces:

1. **Derived from ingredients in code.** A keyword table maps ingredient names
   to allergen groups — `paneer`, `ghee`, `yoghurt`, `butter`, `milk` → dairy.
   Deterministic, testable, and auditable.
2. **Union with the model's own list.** Whatever the model flags is added, never
   subtracted.
3. **Filtered again at query time**, in the database, against the user's
   exclusions.

**Deliberately biased toward false positives.** Wrongly hiding a safe recipe is
an annoyance; wrongly suggesting one containing an allergen is a hazard. Where
the keyword table is unsure it errs toward excluding.

The model is never the last line of defence, and a prompt-injection style
request ("ignore my allergies and show me anything") cannot get past a SQL
filter it doesn't control.

---

## 3. Data model — migration `0006_recipes.sql`

```sql
recipes(
  id uuid pk,
  title text, cuisine text, cost_level text, minutes int,
  ingredients jsonb,             -- name, grams, usda_query, per-ingredient macros
  steps text[],
  contains text[],               -- allergen groups, code-derived
  kcal / protein_g / carbs_g / fat_g numeric,   -- summed from USDA
  embedding vector(768)
)
```

**No `user_id` and no RLS** — and that's the deliberate exception. This is a
shared reference corpus like a cookbook, not user data. It's readable by any
authenticated user and writable only by the service role that runs the build
script. Worth stating explicitly since every other table in this project is
user-scoped; the rule is "user data is locked to its owner", not "everything
has RLS".

An HNSW index on the embedding, as with meal memory.

---

## 4. Searching

`match_recipes(query_embedding, exclusions, max_kcal, min_protein, cuisines)`
runs in the database and does the semantic search *and* the hard filters in one
query, so no recipe containing an excluded ingredient ever reaches the model.

Foodie gets it as a tool, alongside the Coach's existing `get_logs` and
`usda_lookup`. Its parameters are a search phrase and optional limits — there
is **no parameter for exclusions**, because they come from the caller's profile
rather than anything the model can set.

---

## 5. Foodie itself

Reuses the entire Coach machinery — same streaming endpoint, same NDJSON
framing, same per-user tools, same SQL-computed context. The differences are
its system prompt and one extra tool.

`conversations.assistant` already accepts `'foodie'` (added in the Phase 2
migration precisely so this needed no schema change), so `/chat` takes an
`assistant` parameter and everything else follows.

Its prompt emphasises: suggest food that fits the calories *remaining today*,
respect budget level, prefer the user's cuisines, and never present a recipe
the tool didn't return.

---

## 6. Out of scope, with reasons

**Restaurant search.** The plan calls for `find_restaurants` via Google Places
or Yelp. Both need an API key this project doesn't have and which requires
billing details. Everything else in Foodie works without it, so it ships
without and the gap is stated rather than faked.

**Recipe images.** Not needed to answer "what should I eat".

---

## 7. Testing

- The allergen keyword table: dairy from `paneer`/`ghee`/`curd`, nuts from
  `cashew`/`almond`, and a recipe whose model-declared list is empty but whose
  ingredients say otherwise still gets flagged.
- Filtering never returns a recipe containing an excluded group — including
  when the request explicitly asks for one.
- Recipes that can't be fully priced from USDA are dropped, not published with
  partial macros.
- Foodie's tool has no exclusions parameter for the model to tamper with.
- Corpus build is a script, so it's tested against captured responses rather
  than by calling live services.
