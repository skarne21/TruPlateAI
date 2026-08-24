import json
from pathlib import Path

import pytest
import requests

from analysis import (
    FAT_OPTIONS,
    PORTION_OPTIONS,
    apply_fat_answer,
    apply_portion_answer,
    canonical_questions,
    resolve_items,
    totals_for,
)
from vision import VisionAnalysis

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "usda_responses.json").read_text()
)


def fake_search(query: str, page_size: int = 25) -> list[dict]:
    """Offline stand-in for usda.search_food, keyed on words in the query."""
    lowered = query.lower()
    for key in ("idli", "sambar", "ghee", "poha"):
        if key in lowered:
            return FIXTURES[key]
    return []


def vision_item(name="idli", usda_query="idli steamed rice cake", grams=110.0, **kw):
    return {
        "name": name,
        "usda_query": usda_query,
        "portion": {"count": kw.get("count", 2), "unit": kw.get("unit", "piece"), "grams": grams},
        "confidence": kw.get("confidence", 0.9),
        "prep_flags": kw.get("prep_flags", []),
        "llm_estimate": kw.get(
            "llm_estimate",
            {"calories": 200.0, "protein_g": 5.0, "carbs_g": 40.0, "fat_g": 1.0},
        ),
    }


def analysis_with(items, questions=None):
    return VisionAnalysis.model_validate({
        "meal_summary": "test meal",
        "overall_confidence": 0.9,
        "input_mode": "photo",
        "items": items,
        "clarifying_questions": questions or [],
        "warnings": [],
    })


def test_item_priced_from_usda_not_from_llm():
    # Invariant #1: the LLM never supplies the final macro numbers.
    resolved = resolve_items(analysis_with([vision_item()]), search=fake_search)

    assert resolved[0].source == "usda"
    assert resolved[0].usda_description == "Idli"
    # 128 kcal/100g * 110g = 140.8, NOT the llm_estimate's 200.
    assert resolved[0].kcal == pytest.approx(140.8, abs=1)


def test_usda_outage_degrades_to_the_llm_estimate():
    # USDA allows 1000 requests/hour and a meal spends one per item, so an
    # outage or rate-limit is a question of when. It must cost the meal its
    # precision, not the whole log.
    def broken_search(query, page_size=25):
        raise requests.ConnectionError("USDA unreachable")

    resolved = resolve_items(analysis_with([vision_item()]), search=broken_search)
    assert resolved[0].source == "llm"
    assert resolved[0].kcal == pytest.approx(200.0)


def test_falls_back_to_llm_estimate_when_usda_has_no_match():
    resolved = resolve_items(
        analysis_with([vision_item(name="rasam", usda_query="rasam", grams=200)]),
        search=fake_search,
    )
    assert resolved[0].source == "llm"
    assert resolved[0].kcal == pytest.approx(200.0)
    assert resolved[0].usda_fdc_id is None


def test_totals_sum_every_item():
    resolved = resolve_items(
        analysis_with([vision_item(), vision_item(name="sambar", usda_query="sambar", grams=180)]),
        search=fake_search,
    )
    totals = totals_for(resolved)
    assert totals["kcal"] == pytest.approx(sum(i.kcal for i in resolved))
    assert totals["protein_g"] == pytest.approx(sum(i.protein_g for i in resolved))


def test_hidden_fat_question_gets_canonical_options():
    # The LLM decides WHETHER to ask; Python owns what the options are worth.
    questions = canonical_questions(analysis_with([vision_item()], [{
        "id": "q1",
        "question": "How much ghee?",
        "options": ["a splash", "loads"],  # free text from the model, discarded
        "affects_items": ["idli"],
        "reason": "hidden_fat",
        "kcal_impact": "whatever",
    }]))

    assert [o["label"] for o in questions[0]["options"]] == [o[0] for o in FAT_OPTIONS]
    assert questions[0]["kcal_impact"] != "whatever"  # recomputed in Python


def test_fat_question_wording_matches_its_options():
    # Left to the model we get "How was the sambar prepared?" above a list of
    # amounts -- a question its own options don't answer.
    questions = canonical_questions(analysis_with([vision_item()], [{
        "id": "q1", "question": "How was the sambar prepared?", "options": [],
        "affects_items": ["sambar", "chutney"], "reason": "hidden_fat", "kcal_impact": "",
    }]))
    assert questions[0]["question"] == "How much oil or ghee went into the sambar and chutney?"


def test_portion_question_shows_the_real_kcal_swing():
    # "changes this item's portion" tells the user nothing; halving or doubling
    # moves the meal by that item's own calories.
    questions = canonical_questions(analysis_with(
        [vision_item(name="idli", llm_estimate={
            "calories": 180.0, "protein_g": 5.0, "carbs_g": 40.0, "fat_g": 1.0})],
        [{"id": "q1", "question": "?", "options": [], "affects_items": ["idli"],
          "reason": "portion", "kcal_impact": ""}],
    ))
    assert questions[0]["kcal_impact"] == "+/- 180 kcal"
    assert questions[0]["question"] == "How much idli was there?"


def test_identification_questions_are_dropped_not_asked():
    # low_confidence / exclusion_conflict change identification, which Phase 1
    # handles via confirm-screen editing rather than a second LLM round-trip.
    questions = canonical_questions(analysis_with([vision_item()], [
        {"id": "q1", "question": "Is that shrimp?", "options": [], "affects_items": ["idli"],
         "reason": "exclusion_conflict", "kcal_impact": ""},
        {"id": "q2", "question": "How much oil?", "options": [], "affects_items": ["idli"],
         "reason": "hidden_fat", "kcal_impact": ""},
    ]))
    assert [q["id"] for q in questions] == ["q2"]


def test_questions_are_capped_at_three():
    raw = [{"id": f"q{n}", "question": "?", "options": [], "affects_items": ["idli"],
            "reason": "hidden_fat", "kcal_impact": ""} for n in range(5)]
    assert len(canonical_questions(analysis_with([vision_item()], raw))) == 3


def test_fat_answer_appends_a_real_usda_priced_item():
    resolved = resolve_items(analysis_with([vision_item()]), search=fake_search)
    before = totals_for(resolved)["kcal"]

    # option 2 == "1 tbsp total" == 13.6g
    updated = apply_fat_answer(resolved, option_index=2, fat_name="ghee", search=fake_search)

    fat = updated[-1]
    assert fat.grams == pytest.approx(13.6)
    assert fat.source == "user"
    assert "Ghee" in fat.usda_description
    # Priced from USDA, not a hardcoded 9 kcal/g.
    assert fat.kcal > 0
    assert totals_for(updated)["kcal"] > before


def test_fat_answer_none_adds_nothing():
    resolved = resolve_items(analysis_with([vision_item()]), search=fake_search)
    updated = apply_fat_answer(resolved, option_index=0, fat_name="ghee", search=fake_search)
    assert len(updated) == len(resolved)


def test_fat_grams_follow_the_canonical_table():
    assert [grams for _, grams in FAT_OPTIONS] == [0.0, 4.5, 13.6, 27.2]


def test_portion_answer_rescales_grams_and_macros():
    resolved = resolve_items(analysis_with([vision_item()]), search=fake_search)
    original_kcal = resolved[0].kcal

    # option 3 == "about double" == 2.0x
    updated = apply_portion_answer(resolved, item_name="idli", option_index=3)

    assert updated[0].grams == pytest.approx(220.0)
    assert updated[0].kcal == pytest.approx(original_kcal * 2, abs=1)


def test_portion_multipliers_are_the_canonical_table():
    assert [m for _, m in PORTION_OPTIONS] == [0.5, 1.0, 1.5, 2.0]


def test_portion_answer_leaves_other_items_untouched():
    resolved = resolve_items(
        analysis_with([vision_item(), vision_item(name="sambar", usda_query="sambar", grams=180)]),
        search=fake_search,
    )
    sambar_before = resolved[1].kcal
    updated = apply_portion_answer(resolved, item_name="idli", option_index=0)
    assert updated[1].kcal == pytest.approx(sambar_before)


# --- a user's own foods beat USDA ------------------------------------------

from foods import SavedFood  # noqa: E402


def my_poha() -> SavedFood:
    return SavedFood(
        id="food-1", name="Poha", kcal_per_100g=130.0, protein_per_100g=2.5,
        carbs_per_100g=27.0, fat_per_100g=1.5, serving_grams=250.0, source="manual",
    )


def test_a_saved_food_is_used_instead_of_usda():
    # The poha fix. USDA has no poha and returns a groundcherry entry sharing
    # the word; the user's own definition must win outright.
    resolved = resolve_items(
        analysis_with([vision_item(name="Poha", usda_query="poha flattened rice", grams=200)]),
        search=fake_search,
        library=[my_poha()],
    )
    assert resolved[0].source == "user"
    assert resolved[0].kcal == pytest.approx(130 * 2)
    assert "Groundcherries" not in (resolved[0].usda_description or "")


def test_the_saved_food_is_named_as_the_source():
    resolved = resolve_items(
        analysis_with([vision_item(name="Poha", usda_query="poha", grams=100)]),
        search=fake_search, library=[my_poha()],
    )
    # The UI shows this, so it has to say where the numbers came from.
    assert "saved" in (resolved[0].usda_description or "").lower()


def test_foods_not_in_the_library_still_use_usda():
    resolved = resolve_items(
        analysis_with([vision_item()]), search=fake_search, library=[my_poha()]
    )
    assert resolved[0].source == "usda"
    assert resolved[0].usda_description == "Idli"


def test_no_library_behaves_exactly_as_before():
    with_none = resolve_items(analysis_with([vision_item()]), search=fake_search, library=[])
    without = resolve_items(analysis_with([vision_item()]), search=fake_search)
    assert with_none[0].kcal == without[0].kcal
