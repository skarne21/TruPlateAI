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


def pick_best_match(results: list[dict]) -> dict | None:
    """Pick the best food from USDA results: the top-ranked non-Branded entry.

    USDA's own relevance ranking is good -- measured correct at #1 across every
    South Indian and restaurant dish tested. Branded rows are the exception:
    they're specific commercial products (23 different jars of "GHEE" outrank
    the generic "Ghee, clarified butter"), so they're skipped in favour of the
    generic food.

    Deliberately NOT filtered to Foundation/SR Legacy data types: those are raw
    ingredients, while meal photos contain prepared dishes. That filter maps
    "sambar lentil vegetable stew" to "Chicken, stewing".

    ponytail: no relevance threshold. Measured scores don't separate a correct
    match (ghee, 526) from a wrong one (poha -> groundcherries, 640), so a
    cutoff would reject good matches without catching bad ones. The real
    mitigation is showing the matched description in the UI so the user can
    spot and correct it. A per-user alias table is the Phase 3+ upgrade.
    """
    return next((food for food in results if food.get("dataType") != "Branded"), None)


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
