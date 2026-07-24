import json
from pathlib import Path

import pytest

from usda import ENERGY_KCAL, PROTEIN, CARBS, FAT, macros_for_grams, pick_best_match

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "usda_responses.json").read_text()
)


def test_picks_first_non_branded_result():
    # "ghee" returns 23 Branded entries before the generic one. Branded rows are
    # specific commercial products; we want the generic food.
    match = pick_best_match(FIXTURES["ghee"])
    assert match["dataType"] != "Branded"
    assert match["description"] == "Ghee, clarified butter"


def test_prefers_fndds_prepared_dishes_for_composite_foods():
    # The whole reason we don't filter to Foundation/SR Legacy: those are raw
    # ingredients, and a meal photo contains prepared dishes.
    assert pick_best_match(FIXTURES["idli"])["description"] == "Idli"
    assert pick_best_match(FIXTURES["sambar"])["description"] == "Sambar, vegetable stew"


def test_returns_none_when_no_results():
    assert pick_best_match(FIXTURES["empty"]) is None


def test_macros_scale_linearly_with_grams():
    # Idli is 128 kcal / 6.36g protein per 100g (verified against the live API).
    idli = pick_best_match(FIXTURES["idli"])

    per_100 = macros_for_grams(idli, 100)
    assert per_100["kcal"] == pytest.approx(128, abs=1)
    assert per_100["protein_g"] == pytest.approx(6.36, abs=0.1)

    # Two idlis, ~110g total, should be ~1.1x the per-100g values.
    scaled = macros_for_grams(idli, 110)
    assert scaled["kcal"] == pytest.approx(128 * 1.1, abs=1)
    assert scaled["protein_g"] == pytest.approx(6.36 * 1.1, abs=0.1)


def test_zero_grams_gives_zero_macros():
    idli = pick_best_match(FIXTURES["idli"])
    assert macros_for_grams(idli, 0)["kcal"] == 0


def test_missing_nutrient_is_none_not_zero():
    # A missing value and a true zero are different facts. Coercing to 0 would
    # silently under-report calories, which is exactly the failure this app
    # exists to avoid.
    food = {"foodNutrients": [{"nutrientId": PROTEIN, "value": 5.0, "unitName": "G"}]}
    macros = macros_for_grams(food, 100)
    assert macros["protein_g"] == pytest.approx(5.0)
    assert macros["kcal"] is None
    assert macros["carbs_g"] is None
    assert macros["fat_g"] is None


def test_nutrients_matched_by_id_not_name():
    # USDA returns "Energy" rows in both KCAL and KJ. Matching on the name would
    # be ambiguous; the numeric IDs are distinct and stable.
    food = {
        "foodNutrients": [
            {"nutrientId": 1062, "unitName": "kJ", "value": 999.0},  # Energy (kJ)
            {"nutrientId": ENERGY_KCAL, "unitName": "KCAL", "value": 100.0},
        ]
    }
    assert macros_for_grams(food, 100)["kcal"] == pytest.approx(100.0)


def test_known_limitation_homonym_match():
    # Documents real behaviour rather than asserting correctness: USDA has no
    # "poha" (flattened rice), so it matches a groundcherry entry that happens to
    # share the word. No relevance score separates this from a correct match --
    # the mitigation is showing the matched description in the UI so the user can
    # spot and fix it, not a smarter matcher.
    match = pick_best_match(FIXTURES["poha"])
    assert "Groundcherries" in match["description"]
