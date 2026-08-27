import pytest
from google.genai import errors as genai_errors
from pydantic import ValidationError

from vision import (
    FAT_PHOTO_PROMPT,
    FatAnswer,
    VisionAnalysis,
    VisionError,
    analyze_meal,
    build_prompt,
    identify_fat_from_photo,
)

# The documented example output from docs/vision-prompt.md, trimmed to two items.
VALID_ANALYSIS = {
    "meal_summary": "masala dosa with sambar",
    "overall_confidence": 0.86,
    "input_mode": "photo",
    "items": [
        {
            "name": "masala dosa",
            "usda_query": "dosa rice crepe potato filling",
            "portion": {"count": 1, "unit": "piece", "grams": 220},
            "confidence": 0.92,
            "prep_flags": ["hidden_fat_risk"],
            "llm_estimate": {"calories": 380, "protein_g": 8, "carbs_g": 58, "fat_g": 12},
        },
        {
            "name": "sambar",
            "usda_query": "sambar lentil vegetable stew",
            "portion": {"count": 1, "unit": "cup", "grams": 180},
            "confidence": 0.88,
            "prep_flags": ["hidden_fat_risk"],
            "llm_estimate": {"calories": 140, "protein_g": 7, "carbs_g": 20, "fat_g": 4},
        },
    ],
    "clarifying_questions": [
        {
            "id": "q1",
            "question": "How much ghee or oil was used?",
            "options": ["none", "1 tsp total", "1 tbsp total", "2+ tbsp total"],
            "affects_items": ["masala dosa", "sambar"],
            "reason": "hidden_fat",
            "kcal_impact": "+/-240 kcal",
        }
    ],
    "warnings": [],
}


class FakeResponse:
    def __init__(self, parsed=None, text=""):
        self.parsed = parsed
        self.text = text


class FakeClient:
    """Records calls and replays a scripted list of responses."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        return self._responses.pop(0)


def test_validates_documented_example_schema():
    analysis = VisionAnalysis.model_validate(VALID_ANALYSIS)
    assert analysis.meal_summary == "masala dosa with sambar"
    assert analysis.items[0].portion.grams == 220
    assert analysis.clarifying_questions[0].reason == "hidden_fat"


def test_rejects_malformed_output():
    broken = {**VALID_ANALYSIS, "items": [{"name": "dosa"}]}  # missing portion etc.
    with pytest.raises(ValidationError):
        VisionAnalysis.model_validate(broken)


def test_returns_parsed_analysis_on_first_try():
    client = FakeClient([FakeResponse(parsed=VisionAnalysis.model_validate(VALID_ANALYSIS))])
    result = analyze_meal("prompt", client=client)
    assert result.meal_summary == "masala dosa with sambar"
    assert len(client.calls) == 1


def test_retries_once_with_validation_error_appended():
    # CLAUDE.md: malformed LLM output triggers one retry with the validation
    # error appended, then a graceful failure.
    client = FakeClient([
        FakeResponse(parsed=None, text='{"meal_summary": "broken"}'),
        FakeResponse(parsed=VisionAnalysis.model_validate(VALID_ANALYSIS)),
    ])
    result = analyze_meal("original prompt", client=client)

    assert result.meal_summary == "masala dosa with sambar"
    assert len(client.calls) == 2
    retry_text = str(client.calls[1]["contents"])
    assert "original prompt" in retry_text
    assert "validation" in retry_text.lower() or "error" in retry_text.lower()


def test_raises_after_second_failure():
    client = FakeClient([
        FakeResponse(parsed=None, text="not json"),
        FakeResponse(parsed=None, text="still not json"),
    ])
    with pytest.raises(VisionError):
        analyze_meal("prompt", client=client)
    assert len(client.calls) == 2


def test_multiple_images_become_multiple_parts_in_one_call():
    # Several photos of the SAME meal -- one call, one analysis, not one per photo.
    client = FakeClient([FakeResponse(parsed=VisionAnalysis.model_validate(VALID_ANALYSIS))])
    analyze_meal("prompt", images=[(b"a", "image/jpeg"), (b"b", "image/jpeg")], client=client)

    assert len(client.calls) == 1
    contents = client.calls[0]["contents"]
    assert len(contents) == 3  # two image parts + the prompt text


def test_prompt_injects_profile_and_warns_against_double_counting():
    prompt = build_prompt({"cuisines": ["South Indian"], "exclusions": ["Seafood"]})
    assert "South Indian" in prompt
    assert "Seafood" in prompt
    # The obvious multi-photo failure mode is reporting two dosas for two photos.
    assert "same meal" in prompt.lower()


def test_prompt_handles_empty_profile_lists():
    # A user with no cuisines/exclusions set must not produce "[]" in the prompt.
    prompt = build_prompt({"cuisines": [], "exclusions": []})
    assert "[]" not in prompt


def test_fat_photo_gives_type_and_amount():
    client = FakeClient([FakeResponse(
        parsed=FatAnswer(fat_name="ghee", grams=13.6, confidence=0.8)
    )])
    answer = identify_fat_from_photo(b"img", "image/jpeg", client=client)
    assert answer.fat_name == "ghee"
    assert answer.grams == pytest.approx(13.6)


def test_fat_photo_may_return_no_amount():
    # A photo of a ghee jar shows WHAT but not HOW MUCH. The model must say so
    # rather than inventing a quantity -- the app then keeps asking the amount.
    client = FakeClient([FakeResponse(
        parsed=FatAnswer(fat_name="ghee", grams=None, confidence=0.9)
    )])
    assert identify_fat_from_photo(b"img", "image/jpeg", client=client).grams is None


def test_fat_photo_prompt_forbids_guessing_the_amount():
    assert "do not guess" in FAT_PHOTO_PROMPT.lower()


class BoomClient(FakeClient):
    def __init__(self, exc):
        super().__init__([])
        self._exc = exc

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        raise self._exc


def _server_error():
    return genai_errors.ServerError(
        503, {"error": {"message": "This model is currently experiencing high demand."}}
    )


def test_gemini_outage_becomes_vision_error_not_a_bare_500():
    # A raw ServerError escapes past CORSMiddleware, so the browser reports a
    # phantom "blocked by CORS policy" instead of the real cause.
    with pytest.raises(VisionError, match="busy"):
        analyze_meal("prompt", client=BoomClient(_server_error()))


def test_gemini_outage_on_fat_photo_becomes_vision_error():
    with pytest.raises(VisionError, match="busy"):
        identify_fat_from_photo(b"img", "image/jpeg", client=BoomClient(_server_error()))


def test_fat_photo_can_report_no_fat_at_all():
    # Without a null option the model writes its refusal into the name and the
    # UI renders "Found no fat detected in your photo".
    client = FakeClient([FakeResponse(
        parsed=FatAnswer(fat_name=None, grams=None, confidence=0.9)
    )])
    assert identify_fat_from_photo(b"img", "image/jpeg", client=client).fat_name is None


def test_fat_photo_prompt_asks_for_null_not_a_sentence():
    assert "null" in FAT_PHOTO_PROMPT.lower()


# --- naming the user's own foods -----------------------------------------
#
# "my protein powder" can only resolve to a specific product if the model is
# told which products this user has saved. The model still only supplies the
# NAME; the macros come from the user's stored numbers in resolve_items.

from foods import SavedFood
from vision import describe_library

WHEY = SavedFood(
    id="f1", name="Gold Standard Whey", brand="Optimum Nutrition",
    kcal_per_100g=400, protein_per_100g=80, carbs_per_100g=8, fat_per_100g=6,
    serving_grams=31, source="manual",
)
POHA = SavedFood(
    id="f2", name="Poha", brand=None,
    kcal_per_100g=130, protein_per_100g=3, carbs_per_100g=26, fat_per_100g=2,
    serving_grams=250, source="manual",
)


def test_the_prompt_lists_the_users_saved_foods():
    prompt = build_prompt({"cuisines": [], "exclusions": []}, library=[WHEY])
    assert "Gold Standard Whey" in prompt
    # The brand is what makes "my protein powder" answerable at all.
    assert "Optimum Nutrition" in prompt


def test_the_prompt_gives_the_users_own_serving_size():
    # "a scoop" means their scoop, not a generic 100g.
    assert "31g" in describe_library([WHEY])


def test_a_library_with_no_brand_still_reads_cleanly():
    line = describe_library([POHA])
    assert '"Poha"' in line
    assert "--" not in line  # no empty brand separator left dangling


def test_an_empty_library_says_so_rather_than_leaving_a_hole():
    prompt = build_prompt({"cuisines": [], "exclusions": []}, library=[])
    assert "(none saved yet)" in prompt


def test_the_prompt_still_builds_when_no_library_is_passed():
    # /analyze is not the only caller, and a missing library must never be an
    # error -- the library improves logging, it is not required for it.
    assert "SAVED FOODS" in build_prompt({"cuisines": [], "exclusions": []})


def test_the_model_is_told_not_to_match_a_merely_similar_food():
    # The whole risk of this feature: silently swapping in someone's saved
    # numbers for a different product.
    prompt = build_prompt({"cuisines": [], "exclusions": []}, library=[WHEY])
    assert "genuinely the same food" in prompt
