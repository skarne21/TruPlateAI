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
    # NOT a bare "mince": it matched "minced garlic" and flagged a tofu
    # teriyaki bowl as containing beef.
    "beef": ["beef", "steak", "veal", "brisket", "minced beef", "beef mince"],
    "alcohol": ["wine", "beer", "rum", "vodka", "whisky", "whiskey", "brandy",
                "sherry", "mirin", "sake", "liqueur", "bourbon"],
}

# What a user can tick in onboarding, mapped to the groups above.
#
# This exists because the two vocabularies were different and nothing noticed:
# the profile stored "Seafood", recipes stored "seafood", and the database
# compared them with exact string overlap -- so the safety filter matched
# NOTHING. Both sides now go through here before they ever meet.
EXCLUSION_ALIASES: dict[str, str] = {
    "tree nuts": "nuts",
    "treenuts": "nuts",
    "nuts": "nuts",
    "peanut": "peanuts",
    "shell fish": "shellfish",
    "fish": "seafood",
    "milk": "dairy",
    "lactose": "dairy",
    "egg": "eggs",
    "wheat": "gluten",
}


def normalize_exclusions(labels: list[str]) -> list[str]:
    """Turn whatever the user ticked into canonical allergen groups.

    Anything unrecognised is dropped rather than passed through: a custom entry
    like "cilantro" is not an allergen group, and forwarding it into the filter
    would match nothing while looking like protection.
    """
    groups = set()
    for label in labels or []:
        key = " ".join(str(label).lower().split())
        if key in ALLERGEN_KEYWORDS:
            groups.add(key)
        elif key in EXCLUSION_ALIASES:
            groups.add(EXCLUSION_ALIASES[key])
    return sorted(groups)


# An unpriceable ingredient lighter than this is skipped rather than sinking
# the recipe. Real recipes are full of asafoetida, curry leaves and pinches of
# things USDA has never heard of -- being strict about them dropped 32 of 32
# recipes on the first corpus build. Anything heavier is real food, and
# omitting it would publish macros quietly missing a component.
MINOR_GRAMS = 30.0

# Even many tiny unknowns eventually add up to a recipe we can't honestly
# price. Reject once this share of the total mass is unaccounted for.
MAX_UNPRICED_FRACTION = 0.15


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
    # The model writes "Pork"; the keyword table derives "pork". Storing both
    # is how a filter starts missing one of them, so everything is normalised
    # to the same canonical group before it is stored.
    found = set(normalize_exclusions(declared or []))

    for ingredient in ingredients:
        name = ingredient.name.lower()
        for group, keywords in ALLERGEN_KEYWORDS.items():
            if any(word in name for word in keywords):
                found.add(group)

    return sorted(found)


def price_ingredient(query: str, grams: float) -> dict[str, float] | None:
    """USDA macros for one ingredient, or None if it can't be priced."""
    try:
        match = usda.pick_best_match(usda.search_food(query), allow_branded=True)
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
    """Sum a recipe's macros from USDA, or None if too much of it can't be priced.

    A recipe published with a real ingredient missing would carry numbers that
    are partly guesswork, presented as confidently as the rest -- the failure
    this project exists to avoid. But being absolute about it dropped every
    single recipe on the first corpus build, because real recipes are full of
    pinches of things USDA has never heard of.

    So: skip unpriceable ingredients too small to matter, reject the recipe if
    a substantial one fails, and reject it anyway if the small ones add up.
    """
    if not ingredients:
        return None

    total = {"kcal": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    total_grams = sum(i.grams for i in ingredients) or 1.0
    unpriced_grams = 0.0

    for ingredient in ingredients:
        macros = price(ingredient.usda_query, ingredient.grams)
        if macros is None:
            if ingredient.grams > MINOR_GRAMS:
                return None
            unpriced_grams += ingredient.grams
            continue
        for key in total:
            total[key] += macros.get(key) or 0.0

    if unpriced_grams / total_grams > MAX_UNPRICED_FRACTION:
        return None

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
