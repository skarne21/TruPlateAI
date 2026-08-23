import json
from pathlib import Path

import pytest
import requests

import usda
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


class FlakyHttp:
    """Fails with the given status a few times, then succeeds."""

    def __init__(self, failures: int, status: int = 404):
        self.failures = failures
        self.status = status
        self.attempts = 0

    def __call__(self, url, params=None, timeout=None):
        self.attempts += 1
        response = type("R", (), {})()
        query = "&".join(f"{k}={v}" for k, v in (params or {}).items())
        response.url = f"{url}?{query}"
        if self.attempts <= self.failures:
            response.status_code = self.status

            def raise_for_status(_url=response.url):
                # requests puts the full URL -- API key and all -- in the message.
                raise requests.HTTPError(f"{self.status} Client Error for url: {_url}")

            response.raise_for_status = raise_for_status
        else:
            response.status_code = 200
            response.raise_for_status = lambda: None
            response.json = lambda: {"foods": [{"fdcId": 1, "dataType": "Survey (FNDDS)",
                                                "description": "Idli", "foodNutrients": []}]}
        return response


def test_a_transient_failure_is_retried(monkeypatch):
    # USDA was measured returning 404 on 13 of 20 identical requests. Without a
    # retry, two thirds of foods would silently fall back to the AI's estimate
    # -- which is exactly the grounding this app is built on.
    http = FlakyHttp(failures=2)
    monkeypatch.setattr(usda.requests, "get", http)
    assert usda.search_food("idli")[0]["description"] == "Idli"
    assert http.attempts == 3


def test_retries_eventually_give_up(monkeypatch):
    http = FlakyHttp(failures=99)
    monkeypatch.setattr(usda.requests, "get", http)
    with pytest.raises(requests.RequestException):
        usda.search_food("idli")
    assert http.attempts == usda.MAX_ATTEMPTS


def test_the_api_key_never_reaches_the_error_message(monkeypatch):
    # requests embeds the full URL, including api_key=..., in HTTPError. That
    # message travels into logs and bug reports, so the key must be stripped.
    monkeypatch.setenv("USDA_API_KEY", "SUPER-SECRET-KEY")
    monkeypatch.setattr(usda.requests, "get", FlakyHttp(failures=99))
    with pytest.raises(requests.RequestException) as excinfo:
        usda.search_food("idli")
    assert "SUPER-SECRET-KEY" not in str(excinfo.value)


def test_sanity_check_overrides_an_implausible_top_match():
    # Regression: a real photo of two bananas logged 830 kcal instead of ~210.
    # USDA ranks "Bananas, dehydrated, or banana powder" (346 kcal/100g) above
    # "Bananas, raw" (89) for the bare query "banana".
    assert "dehydrated" in pick_best_match(FIXTURES["banana"])["description"]

    # The vision model estimated ~89 kcal/100g for what it saw, which is 3.9x
    # off the top hit -- so ranking gets overridden.
    match = pick_best_match(FIXTURES["banana"], expected_kcal_per_100g=89)
    assert match["description"] == "Bananas, raw"
    assert macros_for_grams(match, 240)["kcal"] == pytest.approx(214, abs=5)


def test_sanity_check_keeps_top_match_when_energy_is_plausible():
    # Ranking stays the primary signal. Energy alone would pick "Crepe,
    # chocolate filled" over "Dosa, with filling", so it must not override
    # unless the disagreement is gross.
    assert pick_best_match(FIXTURES["idli"], expected_kcal_per_100g=120)["description"] == "Idli"
    assert (
        pick_best_match(FIXTURES["sambar"], expected_kcal_per_100g=90)["description"]
        == "Sambar, vegetable stew"
    )


def test_sanity_check_ignored_without_an_estimate():
    assert pick_best_match(FIXTURES["banana"], expected_kcal_per_100g=None)["description"] == (
        pick_best_match(FIXTURES["banana"])["description"]
    )


def test_known_limitation_homonym_match():
    # Documents real behaviour rather than asserting correctness: USDA has no
    # "poha" (flattened rice), so it matches a groundcherry entry that happens to
    # share the word. No relevance score separates this from a correct match --
    # the mitigation is showing the matched description in the UI so the user can
    # spot and fix it, not a smarter matcher.
    match = pick_best_match(FIXTURES["poha"])
    assert "Groundcherries" in match["description"]


def test_branded_can_be_allowed_for_pantry_staples():
    # Excluding Branded is right for meal photos, where 23 jars of "GHEE"
    # outrank the generic entry. It's wrong for recipe ingredients: "vegetable
    # oil" returns 25 results and every one is Branded, so excluding them finds
    # nothing at all.
    only_branded = [
        {"fdcId": 1, "dataType": "Branded", "description": "VEGETABLE OIL",
         "foodNutrients": [{"nutrientId": ENERGY_KCAL, "value": 884.0}]},
    ]
    assert pick_best_match(only_branded) is None
    assert pick_best_match(only_branded, allow_branded=True)["description"] == "VEGETABLE OIL"


def test_allowing_branded_still_prefers_a_generic_match():
    # Branded is a fallback, not a preference: the generic row still wins.
    mixed = [
        {"fdcId": 1, "dataType": "Branded", "description": "SOME BRAND OATS", "foodNutrients": []},
        {"fdcId": 2, "dataType": "SR Legacy", "description": "Oats, raw", "foodNutrients": []},
    ]
    assert pick_best_match(mixed, allow_branded=True)["description"] == "Oats, raw"
