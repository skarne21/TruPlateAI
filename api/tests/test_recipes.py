import pytest

from recipes import (
    ALLERGEN_KEYWORDS,
    MINOR_GRAMS,
    normalize_exclusions,
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


def test_a_recipe_missing_a_real_ingredient_is_rejected():
    # Publishing it would mean a recipe whose numbers are partly invented,
    # which is the one thing this project refuses to do. (A *trivial* unknown
    # is skipped instead -- see the threshold tests below.)
    assert price_recipe([ing("Red lentils", 200), ing("Moon dust", 200)], price=fake_price) is None


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


# --- tolerating what USDA can't price --------------------------------------

def test_a_trivial_unpriceable_ingredient_is_skipped():
    # All-or-nothing dropped the ENTIRE first corpus build -- 32 of 32 recipes
    # -- because every real recipe contains something like asafoetida that USDA
    # has never heard of. A gram of it changes nothing.
    total = price_recipe(
        [ing("Red lentils", 200), ing("Asafoetida", 1)], price=fake_price
    )
    assert total is not None
    assert total["kcal"] == pytest.approx(700)


def test_a_substantial_unpriceable_ingredient_still_rejects():
    # 150g of tomato is real food. Skipping it would publish macros that are
    # quietly missing a component, which is worse than having no recipe.
    assert price_recipe(
        [ing("Red lentils", 200), ing("Tomato", 150)], price=fake_price
    ) is None


def test_the_skip_threshold_is_where_it_claims_to_be():
    just_under = price_recipe(
        [ing("Red lentils", 200), ing("Mystery", MINOR_GRAMS - 1)], price=fake_price
    )
    just_over = price_recipe(
        [ing("Red lentils", 200), ing("Mystery", MINOR_GRAMS + 1)], price=fake_price
    )
    assert just_under is not None
    assert just_over is None


def test_a_recipe_that_is_mostly_unpriceable_is_rejected():
    # Many tiny unknowns still add up to a recipe we can't honestly price.
    trivia = [ing(f"Spice {n}", MINOR_GRAMS - 1) for n in range(8)]
    assert price_recipe([ing("Red lentils", 50), *trivia], price=fake_price) is None


# --- the labels the UI actually stores --------------------------------------

# Copied verbatim from web/app/onboarding/types.ts. Every one of these is a
# thing a user can literally tick, so every one has to survive the round trip
# into a filter that works.
UI_EXCLUSION_OPTIONS = [
    "Seafood", "Shellfish", "Dairy", "Eggs", "Peanuts", "Tree nuts",
    "Gluten", "Soy", "Pork", "Beef", "Sesame", "Alcohol",
]


def test_every_option_a_user_can_tick_maps_to_a_real_group():
    # The bug this exists to prevent: the profile stored "Seafood", recipes
    # stored "seafood", and the database compared them with exact string
    # overlap -- so the filter matched NOTHING and a seafood-allergic user
    # would have been shown a mackerel recipe.
    for label in UI_EXCLUSION_OPTIONS:
        groups = normalize_exclusions([label])
        assert groups, f"{label!r} maps to nothing"
        assert all(g in ALLERGEN_KEYWORDS for g in groups), f"{label!r} -> {groups}"


def test_tree_nuts_and_peanuts_map_to_their_separate_groups():
    assert normalize_exclusions(["Tree nuts"]) == ["nuts"]
    assert normalize_exclusions(["Peanuts"]) == ["peanuts"]


def test_normalising_is_case_and_space_insensitive():
    assert normalize_exclusions(["  SEAFOOD "]) == ["seafood"]
    assert normalize_exclusions(["Tree Nuts"]) == ["nuts"]


def test_an_unknown_exclusion_is_dropped_not_passed_through():
    # A custom entry like "cilantro" isn't an allergen group. Passing it into
    # the filter unchanged would match nothing and give false reassurance.
    assert normalize_exclusions(["cilantro"]) == []


def test_recipe_allergens_come_back_normalised():
    # The model writes "Pork"; the keyword table derives "pork". Storing both
    # is how a filter starts missing one of them.
    result = allergens_for([ing("Pork belly")], ["Pork", "Soy"])
    assert result == sorted(set(result))
    assert all(g == g.lower() for g in result)
    assert "pork" in result and "Pork" not in result


def test_a_recipe_and_a_profile_actually_overlap_end_to_end():
    recipe = allergens_for([ing("Mackerel fillet")], [])
    profile = normalize_exclusions(["Seafood"])
    assert set(recipe) & set(profile), (recipe, profile)


def test_minced_garlic_is_not_beef():
    # "mince" as a beef keyword flagged a tofu teriyaki bowl as containing
    # beef, because it matched "minced garlic".
    assert "beef" not in allergens_for([ing("Minced garlic"), ing("Firm tofu")], [])
    assert "beef" in allergens_for([ing("Beef mince")], [])
