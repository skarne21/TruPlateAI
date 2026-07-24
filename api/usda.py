"""USDA FoodData Central lookup and macro scaling.

The LLM identifies foods and portions; this module supplies the actual numbers
(CLAUDE.md invariant #1).
"""

import os

import requests

SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"

# USDA nutrient IDs. Match on ID, never on name -- "Energy" appears twice per
# food (once as KCAL, once as kJ), so the name alone is ambiguous.
ENERGY_KCAL = 1008
PROTEIN = 1003
CARBS = 1005
FAT = 1004

_NUTRIENT_KEYS = {
    ENERGY_KCAL: "kcal",
    PROTEIN: "protein_g",
    CARBS: "carbs_g",
    FAT: "fat_g",
}

# How far the top-ranked match's energy may sit from the vision model's own
# estimate before we stop trusting USDA's ranking. 2x is wide enough to absorb
# ordinary estimation error (measured 1.0-1.4x on correct matches) and tight
# enough to catch a genuine mismatch (dehydrated vs raw banana was 3.9x).
SANITY_RATIO = 2.0

# Cap on how deep to look. Far enough down to find the right entry, not so far
# that a barely-relevant food can win on energy alone.
MAX_CANDIDATES = 10


def search_food(query: str, page_size: int = 25) -> list[dict]:
    """Search USDA for a food. Returns raw result dicts, USDA's ranking preserved.

    Note: USDA's own `dataType` query parameter is unusable -- passing
    `dataType=Survey (FNDDS)` returns 400 from their nginx because the
    URL-encoded parentheses are rejected before reaching the application.
    Filtering happens in pick_best_match() instead. Don't "fix" this back.
    """
    response = requests.get(
        SEARCH_URL,
        params={
            "api_key": os.environ["USDA_API_KEY"],
            "query": query,
            "pageSize": page_size,
        },
        timeout=10,
    )
    response.raise_for_status()
    return response.json().get("foods", [])


def _energy_per_100g(food: dict) -> float | None:
    for nutrient in food.get("foodNutrients", []):
        if nutrient.get("nutrientId") == ENERGY_KCAL:
            return nutrient.get("value")
    return None


def pick_best_match(
    results: list[dict], expected_kcal_per_100g: float | None = None
) -> dict | None:
    """Pick the best food from USDA results.

    Default to USDA's own relevance ranking, skipping Branded rows -- those are
    specific commercial products, and 23 different jars of "GHEE" outrank the
    generic "Ghee, clarified butter".

    Deliberately NOT filtered to Foundation/SR Legacy data types: those are raw
    ingredients, while meal photos contain prepared dishes. That filter maps
    "sambar lentil vegetable stew" to "Chicken, stewing".

    USDA's ranking is reliable for descriptive multi-word queries but not for
    bare ones: "banana" ranks "Bananas, dehydrated, or banana powder"
    (346 kcal/100g) above "Bananas, raw" (89), a 4x error on a photo of fruit.
    So `expected_kcal_per_100g` -- the vision model's own estimate for the food
    it actually saw -- is used as a sanity check. Ranking wins unless the top
    hit's energy is grossly inconsistent with it, in which case the closest
    candidate is taken instead.

    The estimate only chooses BETWEEN USDA rows; the numbers still come from
    USDA (invariant #1). Energy alone is not enough to rank by -- it picks
    "Crepe, chocolate filled" over "Dosa, with filling" -- which is why
    relevance stays the primary signal.
    """
    candidates = [f for f in results if f.get("dataType") != "Branded"][:MAX_CANDIDATES]
    if not candidates:
        return None

    top = candidates[0]
    top_energy = _energy_per_100g(top)
    if not expected_kcal_per_100g or not top_energy:
        return top

    ratio = max(top_energy / expected_kcal_per_100g, expected_kcal_per_100g / top_energy)
    if ratio <= SANITY_RATIO:
        return top

    # Top hit is implausible for what the model saw; prefer the nearest match.
    scored = [
        (abs(_energy_per_100g(f) - expected_kcal_per_100g), i, f)
        for i, f in enumerate(candidates)
        if _energy_per_100g(f)
    ]
    return min(scored)[2] if scored else top


def macros_for_grams(food: dict, grams: float) -> dict[str, float | None]:
    """Scale a USDA food's per-100g nutrients to an actual portion.

    Foundation, SR Legacy and Survey (FNDDS) search results are all per 100g.
    A nutrient absent from the response yields None, not 0 -- a missing value
    and a true zero are different facts, and silently coercing to zero would
    under-report calories.
    """
    scale = grams / 100.0
    macros: dict[str, float | None] = dict.fromkeys(_NUTRIENT_KEYS.values())

    for nutrient in food.get("foodNutrients", []):
        key = _NUTRIENT_KEYS.get(nutrient.get("nutrientId"))
        if key is not None and nutrient.get("value") is not None:
            macros[key] = nutrient["value"] * scale

    return macros
