import pytest

from recipes import (
    ALLERGEN_KEYWORDS,
    Ingredient,
    allergens_for,
    price_recipe,
    recipe_search_text,
)


def ing(name: str, grams: float = 100, query: str | None = None) -> Ingredient:
    return Ingredient(name=name, grams=grams, usda_query=query or name)


# --- allergen detection: the safety-critical part --------------------------

def test_dairy_is_found_in_south_asian_ingredient_names():
    # "paneer", "ghee" and "curd" are dairy but contain none of the obvious
    # words. A table that only knows "milk" and "cheese" would pass them.
    for name in ("Paneer", "Ghee", "Fresh Curd", "Yoghurt", "Butter", "Whole Milk"):
        assert "dairy" in allergens_for([ing(name)], []), name


def test_nuts_and_peanuts_are_separate_groups():
    assert "nuts" in allergens_for([ing("Cashew paste")], [])
    assert "peanuts" in allergens_for([ing("Peanut oil")], [])
    # Peanuts are legumes; someone avoiding tree nuts may eat them and vice
    # versa, so conflating the two would be wrong in both directions.
    assert "nuts" not in allergens_for([ing("Peanut oil")], [])


def test_the_models_own_list_is_added_never_subtracted():
    # The model said "dairy"; the ingredients don't obviously show it. Trust it
    # anyway -- for allergens we only ever widen.
    assert "dairy" in allergens_for([ing("Mystery sauce")], ["dairy"])


def test_ingredients_win_when_the_model_missed_something():
    # The dangerous direction: model declares nothing, ingredients say dairy.
    result = allergens_for([ing("Paneer"), ing("Tomato")], [])
    assert "dairy" in result


def test_detection_is_case_and_substring_insensitive():
    assert allergens_for([ing("PANEER CUBES")], []) == allergens_for([ing("paneer")], [])


def test_a_clean_recipe_has_no_allergens():
    assert allergens_for([ing("Tomato"), ing("Onion"), ing("Red lentils")], []) == []


def test_every_keyword_group_is_reachable():
    # A typo in the table would silently make a whole allergen undetectable.
    for group, words in ALLERGEN_KEYWORDS.items():
        assert words, group
        assert group in allergens_for([ing(words[0])], []), group


# --- pricing: no invented numbers ------------------------------------------

FAKE_USDA = {
    "red lentils": {"kcal": 350.0, "protein_g": 24.0, "carbs_g": 60.0, "fat_g": 1.0},
    "onion": {"kcal": 40.0, "protein_g": 1.0, "carbs_g": 9.0, "fat_g": 0.1},
}


def fake_price(query: str, grams: float):
    macros = FAKE_USDA.get(query.lower())
    if macros is None:
        return None
    return {k: v * grams / 100 for k, v in macros.items()}


def test_macros_are_summed_from_priced_ingredients():
    total = price_recipe([ing("Red lentils", 200), ing("Onion", 100)], price=fake_price)
    assert total["kcal"] == pytest.approx(350 * 2 + 40)
    assert total["protein_g"] == pytest.approx(24 * 2 + 1)


def test_a_recipe_with_an_unpriceable_ingredient_is_rejected():
    # Publishing it would mean a recipe with numbers that are partly invented,
    # which is the one thing this project refuses to do.
    assert price_recipe([ing("Red lentils", 200), ing("Moon dust", 5)], price=fake_price) is None


def test_a_recipe_with_no_ingredients_is_rejected():
    assert price_recipe([], price=fake_price) is None


# --- what gets embedded ----------------------------------------------------

def test_search_text_covers_title_cuisine_and_ingredients():
    text = recipe_search_text("Lentil Dal", "South Indian", [ing("Red lentils"), ing("Onion")])
    for expected in ("lentil dal", "south indian", "red lentils", "onion"):
        assert expected in text.lower()


# --- the recipe tool: exclusions must be unreachable by the model -----------

class FakeRpcClient:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return type("Q", (), {"execute": lambda _s=None: type("R", (), {"data": self.rows})()})()


def test_the_model_cannot_pass_exclusions(monkeypatch):
    # The whole safety argument. If the model could set this parameter, a
    # request like "ignore my allergies" would have something to aim at.
    import chat
    monkeypatch.setattr(chat.memory, "embed_meal", lambda _t: [0.1, 0.2])
    tool = chat.build_recipe_tool(FakeRpcClient(), ["dairy"])
    assert "exclusions" not in tool.__annotations__


def test_exclusions_come_from_the_profile(monkeypatch):
    import chat
    monkeypatch.setattr(chat.memory, "embed_meal", lambda _t: [0.1, 0.2])
    client = FakeRpcClient()
    chat.build_recipe_tool(client, ["dairy", "nuts"])("something to eat")

    _, params = client.calls[0]
    assert params["exclusions"] == ["dairy", "nuts"]


def test_recipe_search_survives_the_database_being_unavailable(monkeypatch):
    import chat

    class Broken(FakeRpcClient):
        def rpc(self, name, params):
            raise RuntimeError("no such function")

    monkeypatch.setattr(chat.memory, "embed_meal", lambda _t: [0.1, 0.2])
    result = chat.build_recipe_tool(Broken(), [])("dinner")
    assert result["recipes"] == []
    assert "note" in result


def test_recipe_search_without_an_embedding_returns_nothing(monkeypatch):
    import chat
    monkeypatch.setattr(chat.memory, "embed_meal", lambda _t: None)
    client = FakeRpcClient()
    assert chat.build_recipe_tool(client, [])("dinner")["recipes"] == []
    assert client.calls == []  # never searched with nothing
