"""Meal memory: recognise a meal you've logged before.

Confirmed meals are turned into a list of numbers (an "embedding") that
captures what the meal *means* rather than how it was spelled, so
"2 idlis with sambar" and "idli x2, sambar" land close together. On a new
analysis we look for anything close enough to be the same meal and offer the
numbers you already corrected.

This is what makes accuracy improve with use instead of staying flat.
"""

import math
import os

from google import genai
from google.genai import types

MODEL = "gemini-embedding-001"

# The model returns 3072 numbers by default, which pgvector cannot index --
# its index types stop at 2000. 768 is indexable, a quarter the storage, and
# measured to separate meals cleanly.
EMBED_DIMENSIONS = 768

# Measured against the live model, comparing meals to
# "2 idlis with sambar and coconut chutney":
#     0.9426  same meal, worded differently        -> should match
#     0.9245  same dish, different count           -> should match
#     0.8299  masala dosa with the same sides      -> must NOT match
#     0.5798  same cuisine, different meal         -> must not match
# 0.90 clears the dosa case with room either side. Raising this makes the
# feature shy; lowering it starts putting the wrong main course in someone's log.
MATCH_THRESHOLD = 0.90

# How many candidates the database returns before the threshold is applied.
SEARCH_LIMIT = 3


def normalize(vector: list[float]) -> list[float]:
    """Scale a vector to length 1.

    Required because reduced-dimension embeddings arrive un-normalised (a 768
    vector measured 0.59 long, where the full 3072 output is exactly 1.0).
    Cosine similarity assumes unit vectors, so skipping this wouldn't crash --
    it would quietly make every comparison slightly wrong.
    """
    magnitude = math.sqrt(sum(x * x for x in vector))
    if magnitude == 0:
        return list(vector)
    return [x / magnitude for x in vector]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """How alike two meals are: 1.0 identical, 0.0 unrelated, -1.0 opposite."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def embed_meal(summary: str, *, client: genai.Client | None = None) -> list[float] | None:
    """Turn a meal description into a vector, or None if that isn't possible.

    Returns None rather than raising on failure: meal memory is a convenience,
    and losing a real logged meal because an optional feature broke would be a
    straight downgrade.
    """
    if not summary or not summary.strip():
        return None

    client = client or genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    try:
        response = client.models.embed_content(
            model=MODEL,
            contents=summary.strip(),
            config=types.EmbedContentConfig(output_dimensionality=EMBED_DIMENSIONS),
        )
        return normalize(list(response.embeddings[0].values))
    except Exception:
        return None


def find_similar_meal(client, user_id: str, embedding: list[float] | None) -> dict | None:
    """The user's closest previous meal, if it's close enough to be the same one.

    The search runs inside the database through the same row-level lock as
    every other query, so one user's history can never appear in another's
    results. That is the reason for keeping vectors in Postgres rather than a
    separate vector service, which would need its own access control built
    from scratch.
    """
    if not embedding:
        return None

    try:
        rows = client.rpc(
            "match_meals",
            {
                "query_embedding": embedding,
                "match_user_id": user_id,
                "match_count": SEARCH_LIMIT,
            },
        ).execute().data
    except Exception:
        # Memory is optional; an analysis must still succeed without it.
        return None

    if not rows:
        return None

    best = rows[0]
    if float(best.get("similarity") or 0) < MATCH_THRESHOLD:
        return None
    return best


def recent_meal_summaries(client, user_id: str, limit: int = 10) -> list[str]:
    """Recent meal descriptions, to prime the vision prompt.

    Telling the model what this user actually eats biases identification
    towards it -- the difference between reading a photo as "dosa" and as
    "crepe".
    """
    try:
        rows = (
            client.table("meal_embeddings")
            .select("summary")
            .eq("user_id", user_id)
            .limit(limit)
            .execute()
        ).data
    except Exception:
        return []
    return [r["summary"] for r in rows if r.get("summary")]
