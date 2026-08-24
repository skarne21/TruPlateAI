import pytest

from foods import (
    SavedFood,
    macros_for_portion,
    match_saved_food,
    normalize_name,
)


def saved(name: str, kcal: float = 100.0, **kw) -> SavedFood:
    return SavedFood(
        id=kw.get("id", "food-1"),
        name=name,
        brand=kw.get("brand"),
        barcode=kw.get("barcode"),
        kcal_per_100g=kcal,
        protein_per_100g=kw.get("protein", 10.0),
        carbs_per_100g=kw.get("carbs", 20.0),
        fat_per_100g=kw.get("fat", 1.0),
        serving_grams=kw.get("serving_grams", 100.0),
        source=kw.get("source", "manual"),
    )


# --- name matching ---------------------------------------------------------

def test_names_match_regardless_of_case_and_spacing():
    assert normalize_name("  Poha  ") == normalize_name("poha")
    assert normalize_name("Greek Yoghurt") == normalize_name("greek yoghurt")


def test_plurals_match_the_singular():
    # The model says "idlis"; the saved food is "idli". Failing to match here
    # would silently fall back to USDA and lose the user's own numbers.
    assert normalize_name("idlis") == normalize_name("idli")
    assert normalize_name("Bananas") == normalize_name("banana")


def test_a_saved_food_is_found_by_name():
    library = [saved("Poha"), saved("Greek yoghurt", id="food-2")]
    assert match_saved_food("poha", "flattened rice", library).id == "food-1"


def test_the_usda_query_is_also_tried():
    # The model may name a dish loosely but produce a precise search phrase,
    # or the other way round. Either is worth matching on.
    library = [saved("Flattened rice")]
    assert match_saved_food("Poha", "flattened rice", library) is not None


def test_no_match_returns_nothing_rather_than_a_guess():
    # A near-miss must fall through to USDA rather than silently substituting
    # somebody's saved food for a different one.
    assert match_saved_food("chicken curry", "chicken curry", [saved("Poha")]) is None


def test_an_empty_library_matches_nothing():
    assert match_saved_food("poha", "poha", []) is None


def test_matching_ignores_a_blank_query():
    assert match_saved_food("Poha", "", [saved("Poha")]) is not None


# --- portioning ------------------------------------------------------------

def test_macros_scale_from_per_100g():
    food = saved("Poha", kcal=130.0, protein=2.5)
    macros = macros_for_portion(food, 250)
    assert macros["kcal"] == pytest.approx(130 * 2.5)
    assert macros["protein_g"] == pytest.approx(2.5 * 2.5)


def test_zero_grams_is_zero_not_a_crash():
    assert macros_for_portion(saved("Poha"), 0)["kcal"] == 0


def test_a_saved_food_keeps_its_own_serving_size():
    # "One serving" of the user's poha is whatever they said it was, not 100g.
    food = saved("Poha", kcal=130.0, serving_grams=250.0)
    assert macros_for_portion(food, food.serving_grams)["kcal"] == pytest.approx(325)
