import math

import pytest

from memory import (
    EMBED_DIMENSIONS,
    MATCH_THRESHOLD,
    cosine_similarity,
    embed_meal,
    find_similar_meal,
    normalize,
)


class FakeEmbedding:
    def __init__(self, values):
        self.values = values


class FakeResponse:
    def __init__(self, values):
        self.embeddings = [FakeEmbedding(values)]


class FakeGemini:
    """Records calls and replays scripted vectors."""

    def __init__(self, vectors=None, error=None):
        self._vectors = list(vectors or [])
        self._error = error
        self.calls = []
        self.models = self

    def embed_content(self, *, model, contents, config=None):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._error:
            raise self._error
        return FakeResponse(self._vectors.pop(0))


class FakeQuery:
    def __init__(self, rows, calls):
        self._rows = rows
        self.calls = calls

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.calls.append(("eq", column, value))
        return self

    def limit(self, *_):
        return self

    def execute(self):
        return type("R", (), {"data": self._rows})()


class FakeClient:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.calls = []
        self.rpc_calls = []

    def table(self, _name):
        return FakeQuery(self.rows, self.calls)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return FakeQuery(self.rows, self.calls)


# --- normalising -----------------------------------------------------------

def test_normalize_scales_to_unit_length():
    # Reduced-dimension embeddings arrive with a magnitude around 0.59. Cosine
    # similarity assumes unit vectors, so skipping this wouldn't crash -- it
    # would quietly degrade every comparison.
    result = normalize([3.0, 4.0])
    assert math.sqrt(sum(x * x for x in result)) == pytest.approx(1.0)
    assert result == pytest.approx([0.6, 0.8])


def test_normalize_leaves_a_unit_vector_alone():
    assert normalize([1.0, 0.0, 0.0]) == pytest.approx([1.0, 0.0, 0.0])


def test_normalize_survives_an_all_zero_vector():
    # Dividing by a zero magnitude would crash; a degenerate vector should just
    # come back unchanged rather than take down a meal log.
    assert normalize([0.0, 0.0]) == [0.0, 0.0]


# --- similarity ------------------------------------------------------------

def test_identical_vectors_score_one():
    v = normalize([0.4, 0.9, 0.1])
    assert cosine_similarity(v, v) == pytest.approx(1.0)


def test_perpendicular_vectors_score_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_opposite_vectors_score_minus_one():
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


# --- the threshold, pinned to real measurements ----------------------------

def test_threshold_accepts_the_same_meal_reworded():
    # Measured 0.9426 for "idli x2, sambar, coconut chutney" against
    # "2 idlis with sambar and coconut chutney".
    assert 0.9426 >= MATCH_THRESHOLD


def test_threshold_accepts_the_same_dish_at_a_different_count():
    # "3 idlis" vs "2 idlis" measured 0.9245. Still your usual meal; the
    # portion is editable afterwards.
    assert 0.9245 >= MATCH_THRESHOLD


def test_threshold_rejects_a_different_dish_sharing_side_orders():
    # Masala dosa with the same sambar and chutney measured 0.8299. It shares
    # two of three components and is a different meal -- offering it as "your
    # usual" would put the wrong main course in someone's log.
    assert 0.8299 < MATCH_THRESHOLD


def test_threshold_rejects_an_unrelated_meal():
    assert 0.5798 < MATCH_THRESHOLD  # chicken biryani with raita


# --- embedding -------------------------------------------------------------

def test_embed_requests_reduced_dimensions_and_normalises():
    gemini = FakeGemini([[3.0, 4.0]])
    result = embed_meal("2 idlis with sambar", client=gemini)

    assert result == pytest.approx([0.6, 0.8])
    assert gemini.calls[0]["config"].output_dimensionality == EMBED_DIMENSIONS


def test_embed_returns_none_rather_than_raising():
    # A failed embedding must never stop a meal being logged. Losing real data
    # over an optional convenience would be a straight downgrade.
    gemini = FakeGemini(error=RuntimeError("service down"))
    assert embed_meal("anything", client=gemini) is None


def test_embed_skips_empty_text():
    gemini = FakeGemini([[1.0]])
    assert embed_meal("   ", client=gemini) is None
    assert gemini.calls == []  # no point paying for an empty string


# --- searching -------------------------------------------------------------

MATCH_ROW = {
    "meal_id": "meal-1", "summary": "2 idlis with sambar",
    "similarity": 0.95, "logged_on": "2026-08-02",
}


def test_search_returns_a_match_above_the_threshold():
    client = FakeClient([MATCH_ROW])
    match = find_similar_meal(client, "user-a", [1.0, 0.0])
    assert match["meal_id"] == "meal-1"
    assert match["similarity"] == pytest.approx(0.95)


def test_search_rejects_a_match_below_the_threshold():
    client = FakeClient([{**MATCH_ROW, "similarity": 0.83}])
    assert find_similar_meal(client, "user-a", [1.0, 0.0]) is None


def test_search_is_scoped_to_the_calling_user():
    client = FakeClient([MATCH_ROW])
    find_similar_meal(client, "user-a", [1.0, 0.0])
    _, params = client.rpc_calls[0]
    assert params["match_user_id"] == "user-a"


def test_search_without_an_embedding_returns_nothing():
    # Embedding failed upstream; searching with nothing would be meaningless.
    client = FakeClient([MATCH_ROW])
    assert find_similar_meal(client, "user-a", None) is None
    assert client.rpc_calls == []


def test_search_survives_the_database_being_unavailable():
    class Broken(FakeClient):
        def rpc(self, name, params):
            raise RuntimeError("no vector extension")

    assert find_similar_meal(Broken(), "user-a", [1.0, 0.0]) is None
