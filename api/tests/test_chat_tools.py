from datetime import date

import pytest

from chat import build_tools, fetch_days

TODAY = date(2026, 7, 24)


class FakeQuery:
    """Minimal stand-in for the chained postgrest query builder."""

    def __init__(self, rows, filters):
        self._rows = rows
        self.filters = filters

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def gte(self, column, value):
        self.filters.append(("gte", column, value))
        return self

    def lte(self, column, value):
        self.filters.append(("lte", column, value))
        return self

    def order(self, *_):
        return self

    def execute(self):
        return type("Result", (), {"data": self._rows})()


class FakeClient:
    def __init__(self, rows):
        self._rows = rows
        self.filters = []

    def table(self, _name):
        return FakeQuery(self._rows, self.filters)


def meal(day: str, kcal: float, protein: float) -> dict:
    return {"logged_on": day, "kcal": kcal, "protein_g": protein, "carbs_g": 0, "fat_g": 0}


def test_multiple_meals_on_one_day_are_summed():
    client = FakeClient([
        meal("2026-07-24", 500, 30),
        meal("2026-07-24", 700, 40),
        meal("2026-07-23", 900, 50),
    ])
    days = fetch_days(client, "user-a", TODAY)

    assert len(days) == 2
    today = next(d for d in days if d.day == TODAY)
    assert today.kcal == pytest.approx(1200)
    assert today.protein_g == pytest.approx(70)
    assert today.meals == 2


def test_days_come_back_newest_first():
    client = FakeClient([
        meal("2026-07-20", 100, 10),
        meal("2026-07-24", 200, 20),
        meal("2026-07-22", 300, 30),
    ])
    days = fetch_days(client, "user-a", TODAY)
    assert [d.day.isoformat() for d in days] == ["2026-07-24", "2026-07-22", "2026-07-20"]


def test_null_macros_do_not_crash_the_sum():
    client = FakeClient([{"logged_on": "2026-07-24", "kcal": None, "protein_g": 40}])
    assert fetch_days(client, "user-a", TODAY)[0].kcal == pytest.approx(0)


def test_query_is_always_scoped_to_the_calling_user():
    client = FakeClient([])
    fetch_days(client, "user-a", TODAY)
    assert ("eq", "user_id", "user-a") in client.filters
    assert ("eq", "status", "confirmed") in client.filters


def test_get_logs_tool_cannot_be_pointed_at_another_user():
    # The tool takes only a day count. There is no parameter for whose data to
    # read, and it closes over the caller's RLS-scoped client -- so the model
    # has no way to ask for someone else's rows.
    client = FakeClient([meal("2026-07-24", 500, 30)])
    get_logs, _ = build_tools(client, "user-a", TODAY)

    assert list(get_logs.__annotations__) == ["days", "return"]
    get_logs(7)
    assert ("eq", "user_id", "user-a") in client.filters


def test_get_logs_clamps_absurd_ranges():
    client = FakeClient([])
    get_logs, _ = build_tools(client, "user-a", TODAY)

    assert get_logs(100000)["days_requested"] == 90
    assert get_logs(0)["days_requested"] == 1


def test_tools_expose_docstrings_the_model_can_read():
    # Automatic function calling derives the tool schema from the signature and
    # docstring, so an undocumented tool is an unusable one.
    for tool in build_tools(FakeClient([]), "user-a", TODAY):
        assert tool.__doc__ and "Args:" in tool.__doc__
