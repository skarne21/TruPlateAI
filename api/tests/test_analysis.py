import json
from pathlib import Path

import pytest

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
