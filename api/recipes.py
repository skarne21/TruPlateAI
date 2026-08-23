"""Recipe corpus: model-written text, USDA-priced numbers, code-checked allergens.

The model invents the recipe; it never invents the macros. Every ingredient is
looked up in USDA and the totals summed, exactly as meals are
(CLAUDE.md invariant #1).

Allergen detection is the safety-critical part of this file. It is done in
code, never by the model (invariant #5), and errs toward over-reporting:
wrongly hiding a safe recipe is an annoyance, wrongly suggesting one that
contains someone's allergen is a hazard.
"""

from typing import Callable

from pydantic import BaseModel

import usda

# Ingredient words that imply an allergen group. Deliberately generous, and
# deliberately including the names that a naive English-only list would miss --
# paneer, ghee and curd are all dairy without containing "milk" or "cheese".
ALLERGEN_KEYWORDS: dict[str, list[str]] = {
    "dairy": [
        "milk", "cheese", "butter", "ghee", "cream", "yoghurt", "yogurt",
        "curd", "paneer", "khoya", "whey", "casein", "custard", "ice cream",
    ],
    "eggs": ["egg", "mayonnaise", "meringue", "albumen"],
    "gluten": [
        "wheat", "flour", "bread", "pasta", "noodle", "semolina", "rava",
        "sooji", "suji", "barley", "rye", "couscous", "seitan", "maida",
    ],
    "nuts": [
        "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut",
        "macadamia", "brazil nut", "praline", "marzipan", "nutella", "coconut",
    ],
    "peanuts": ["peanut", "groundnut", "arachis"],
    "seafood": [
        "fish", "salmon", "tuna", "cod", "anchovy", "sardine", "mackerel",
        "tilapia", "haddock", "trout", "fish sauce",
    ],
    "shellfish": [
        "prawn", "shrimp", "crab", "lobster", "clam", "mussel", "oyster",
        "scallop", "squid", "calamari", "krill",
    ],
    "soy": ["soy", "soya", "tofu", "tempeh", "edamame", "miso", "tamari"],
    "sesame": ["sesame", "tahini", "gingelly", "til "],
    "pork": ["pork", "bacon", "ham", "prosciutto", "chorizo", "pancetta", "lard"],
    "beef": ["beef", "steak", "veal", "brisket", "mince"],
}


class Ingredient(BaseModel):
    name: str
    grams: float
    usda_query: str


def allergens_for(ingredients: list[Ingredient], declared: list[str]) -> list[str]:
    """Allergen groups a recipe contains.

    Two sources, unioned: what the ingredient names imply, and whatever the
    model declared. The model's list is only ever *added* to -- it can widen
    the result but never narrow it, because a model that forgets an allergen
    must not be able to hide one the keyword table found.
    """
    found = set(declared or [])

    for ingredient in ingredients:
        name = ingredient.name.lower()
        for group, keywords in ALLERGEN_KEYWORDS.items():
            if any(word in name for word in keywords):
                found.add(group)

    return sorted(found)


def price_ingredient(query: str, grams: float) -> dict[str, float] | None:
    """USDA macros for one ingredient, or None if it can't be priced."""
    try:
        match = usda.pick_best_match(usda.search_food(query))
    except Exception:
        return None
    if match is None:
        return None
    macros = usda.macros_for_grams(match, grams)
    if macros["kcal"] is None:
        return None
    return {k: (v or 0.0) for k, v in macros.items()}


def price_recipe(
    ingredients: list[Ingredient],
    price: Callable[[str, float], dict[str, float] | None] = price_ingredient,
) -> dict[str, float] | None:
    """Sum a recipe's macros from USDA, or None if any ingredient can't be priced.

    All-or-nothing on purpose. A recipe published with one ingredient missing
    would carry numbers that are partly guesswork, presented with the same
    confidence as the rest -- which is the failure this whole project is built
    to avoid. Better to drop the recipe.
    """
    if not ingredients:
        return None

    total = {"kcal": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    for ingredient in ingredients:
        macros = price(ingredient.usda_query, ingredient.grams)
        if macros is None:
            return None
        for key in total:
            total[key] += macros.get(key) or 0.0

    return total


def recipe_search_text(title: str, cuisine: str, ingredients: list[Ingredient]) -> str:
    """What gets embedded for a recipe.

    Title, cuisine and ingredients -- not the steps. Steps are mostly verbs and
    equipment ("heat the pan, add the mustard seeds") which are near-identical
    across recipes and would blur them together, the same way the meal
    summaries' shared boilerplate did.
    """
    names = ", ".join(i.name for i in ingredients)
    return f"{title}. {cuisine} cuisine. Ingredients: {names}"
