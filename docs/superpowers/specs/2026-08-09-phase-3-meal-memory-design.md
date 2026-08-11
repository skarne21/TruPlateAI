# Phase 3 (part 2) — Meal Memory

**Date:** 2026-08-09
**Status:** Design, ready to implement

**Goal:** the app recognises a meal you've logged before and offers your own
previously corrected numbers in one tap — so corrections persist instead of
evaporating.

**Exit criteria:** log a meal, log something similar again, get offered "log my
usual" with the earlier numbers; a different dish is *not* offered; `pytest`
green.

---

## 1. Why this is the headline feature

Cal AI's most-complained-about behaviour is that corrections don't stick.
Re-scan the same plate, get a different wrong number, fix it again. The app
never learns.

This is the direct answer, and it is the only feature here that makes accuracy
*improve with use* rather than staying flat.

---

## 2. Measured before designing

Against the live API, `gemini-embedding-001`:

**Dimensions.** Default output is **3072**, which pgvector cannot index —
its index types cap at 2000 dimensions. The API accepts an
`output_dimensionality` parameter, so we request **768**: indexable, a quarter
the storage, and ample for this.

**Reduced vectors come back un-normalised.** Only the full 3072 output is a
unit vector; at 768 the magnitude was 0.59. Cosine similarity assumes unit
length, so **we normalise in Python** after requesting a reduced size. Missing
this would not crash anything — it would just quietly degrade every comparison,
which is the worst kind of bug.

**Does it actually discriminate?** Reference: *"2 idlis with sambar and coconut
chutney"*.

| Similarity | Meaning |
|---|---|
| 0.9481 | same meal, more detail |
| 0.9426 | same meal, worded differently |
| 0.9245 | same dish, different count ("3 idlis") |
| **0.8299** | **masala dosa** with the same sides — different dish |
| 0.5798 | same cuisine, different meal |
| 0.4618 | unrelated food |

The dosa row is the one that sets the threshold. It shares two of three
components and must **not** be offered as "your usual". **0.90** clears it with
margin either side.

Different-count still matching (0.9245) is correct — it *is* your usual meal,
and the portion is editable.

---

## 3. How it works

**On `POST /log`:** embed the meal's summary and store the vector next to the
meal. One extra API call per logged meal, roughly 0.3s, after the user has
already committed — so it costs them no waiting.

**On `POST /analyze`, two uses:**

1. *Before* calling the vision model, fetch the user's recent meal summaries
   and inject them into the prompt. The prompt template has always had a
   `{{known_meals}}` slot filled with "(none yet)"; now it carries real data,
   biasing identification toward food this user actually eats.
2. *After* the vision model returns, embed its summary and search for a match
   above 0.90. If one exists, the response carries that meal's stored items so
   "log my usual" is instant rather than another round trip.

**Deliberately not automatic.** A match is *offered*, never applied. The user
taps it. Silently substituting a previous meal's numbers for what's actually on
the plate would be exactly the kind of confident wrongness this project exists
to avoid.

---

## 4. Data model — migration `0005_meal_memory.sql`

```sql
create extension if not exists vector;

meal_embeddings(
  meal_id uuid pk references meals on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  summary text not null,
  embedding vector(768) not null,
  created_at timestamptz default now()
)
```

RLS on `auth.uid() = user_id`, all four verbs, as everywhere else. **Vector
search runs through the same lock as every other query**, so one user's meal
history cannot surface in another's search results — the reason for keeping
this in Postgres rather than a separate vector service, which would need its
own access control invented from scratch.

An HNSW index on cosine distance keeps search fast as history grows.

`meal_id` is the primary key: one embedding per meal, and deleting a meal
takes its embedding with it.

---

## 5. Endpoints

No new routes. `/log` gains a write, `/analyze` gains a `similar_meal` field:

```json
"similar_meal": {
  "meal_id": "...", "summary": "2 idlis with sambar", "similarity": 0.94,
  "logged_on": "2026-08-02", "totals": {...}, "items": [...]
}
```

`null` when nothing clears the threshold.

**Embedding failures must never block a log.** If the embedding call fails, the
meal still saves and simply has no memory entry. Losing a logged meal over an
optional convenience feature would be a straight downgrade.

---

## 6. Testing

- Normalisation: a 768-vector is scaled to unit length; an already-unit vector
  is unchanged.
- Cosine similarity: identical vectors score 1.0, orthogonal 0.0, and the
  measured meal pairs land the right side of the threshold.
- Threshold: the dosa case (0.83) is rejected, the reworded case (0.94) accepted.
- Search is scoped to one user.
- A failed embedding still logs the meal.
- Real API calls are faked, as everywhere in this suite.

---

## 7. Out of scope

The recipe corpus and Foodie, which come next. Also re-embedding when a user
edits a past meal — meals aren't editable after logging yet.
