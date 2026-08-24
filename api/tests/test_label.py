import pytest

from label import (
    LABEL_PROMPT,
    NutritionLabel,
    per_100g,
    read_label,
)


class FakeResponse:
    def __init__(self, parsed=None, text=""):
        self.parsed = parsed
        self.text = text


class FakeGemini:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        return self._responses.pop(0)


def label(**kw) -> NutritionLabel:
    return NutritionLabel(**{
        "product_name": "Oat Crunch", "basis": "per_100g", "serving_grams": None,
        "kcal": 380.0, "protein_g": 9.0, "carbs_g": 60.0, "fat_g": 11.0, **kw,
    })


# --- converting whatever the label says into per-100g ------------------------

def test_a_per_100g_label_passes_straight_through():
    macros = per_100g(label())
    assert macros["kcal_per_100g"] == pytest.approx(380)
    assert macros["protein_per_100g"] == pytest.approx(9)


def test_a_per_serving_label_is_converted():
    # Labels in the US and UK often give per-serving only. Storing those as
    # per-100g would misstate the food by however far the serving differs.
    macros = per_100g(label(basis="per_serving", serving_grams=40.0, kcal=152.0, protein_g=3.6))
    assert macros["kcal_per_100g"] == pytest.approx(380)
    assert macros["protein_per_100g"] == pytest.approx(9)


def test_a_per_serving_label_without_a_serving_size_is_unusable():
    # Nothing can be converted without knowing the serving weight, and guessing
    # would put a wrong number in the library permanently.
    assert per_100g(label(basis="per_serving", serving_grams=None)) is None


def test_a_zero_serving_size_is_rejected_rather_than_dividing_by_zero():
    assert per_100g(label(basis="per_serving", serving_grams=0.0)) is None


def test_a_label_with_no_calories_is_unusable():
    assert per_100g(label(kcal=None)) is None


def test_missing_macros_become_zero_but_calories_never_do():
    macros = per_100g(label(protein_g=None))
    assert macros["protein_per_100g"] == 0
    assert macros["kcal_per_100g"] == pytest.approx(380)


# --- the call ---------------------------------------------------------------

def test_reading_a_label_returns_the_parsed_values():
    gemini = FakeGemini([FakeResponse(parsed=label())])
    result = read_label(b"photo", "image/jpeg", client=gemini)
    assert result.product_name == "Oat Crunch"
    assert result.kcal == pytest.approx(380)


def test_the_prompt_forbids_inventing_numbers():
    # The whole justification for using the model here is that it READS a
    # label. A model filling in what a product usually contains would be
    # inventing nutrition data, which this project refuses to do.
    lowered = LABEL_PROMPT.lower()
    assert "do not" in lowered or "never" in lowered
    assert "null" in lowered


def test_the_prompt_asks_which_basis_the_label_uses():
    assert "per_serving" in LABEL_PROMPT and "per_100g" in LABEL_PROMPT
