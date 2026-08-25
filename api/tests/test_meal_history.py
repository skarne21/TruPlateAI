"""Wiring tests for viewing and deleting logged meals.

Until now a meal could be logged and never seen again -- no way to check what
was recorded, and no way to fix a mistyped portion. That also blocks the eval
work, which depends on comparing what was logged against what was weighed.
"""
import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
from deps import get_current_user_client

USER_ID = "user-a"


class FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters = []

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        self.db.filters.append((self.name, "eq", column, value))
        return self

    def gte(self, *a):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *_):
        return self

    def delete(self):
        self.db.deleted.append(self.name)
        return self

    def execute(self):
        return type("R", (), {"data": self.db.rows.get(self.name, [])})()


class FakeDB:
    def __init__(self, **rows):
        self.rows = rows
        self.filters = []
        self.deleted = []

    def table(self, name):
        return FakeTable(self, name)


MEAL = {
    "id": "meal-1", "logged_on": "2026-08-25", "logged_at": "2026-08-25T09:00:00Z",
    "input_mode": "photo", "caption": "breakfast", "photo_paths": [],
    "kcal": 520, "protein_g": 22, "carbs_g": 70, "fat_g": 14,
    "meal_items": [
        {"name": "Idli", "grams": 110, "kcal": 141, "protein_g": 7,
         "carbs_g": 27, "fat_g": 0, "source": "usda", "usda_description": "Idli"},
    ],
}


@pytest.fixture
def client_and_db():
    db = FakeDB(meals=[MEAL])
    main.app.dependency_overrides[get_current_user_client] = lambda: (USER_ID, db)
    yield TestClient(main.app), db
    main.app.dependency_overrides.clear()


def test_recent_meals_come_back_with_their_items(client_and_db):
    client, _ = client_and_db
    res = client.get("/meals?days=7")
    assert res.status_code == 200
    meals = res.json()
    assert meals[0]["id"] == "meal-1"
    # Totals alone can't be checked against a weighed plate; the items can.
    assert meals[0]["items"][0]["name"] == "Idli"
    assert meals[0]["kcal"] == pytest.approx(520)


def test_history_is_scoped_to_the_caller(client_and_db):
    client, db = client_and_db
    client.get("/meals?days=7")
    assert ("meals", "eq", "user_id", USER_ID) in db.filters


def test_only_confirmed_meals_are_listed(client_and_db):
    client, db = client_and_db
    client.get("/meals?days=7")
    assert ("meals", "eq", "status", "confirmed") in db.filters


def test_an_absurd_range_is_clamped(client_and_db):
    client, _ = client_and_db
    assert client.get("/meals?days=100000").status_code == 200
    assert client.get("/meals?days=0").status_code == 200


def test_a_meal_can_be_deleted(client_and_db):
    client, db = client_and_db
    res = client.delete("/meals/meal-1")
    assert res.status_code == 200
    assert "meals" in db.deleted


def test_deleting_is_scoped_to_the_caller(client_and_db):
    # Without this, a guessed id from another account would delete their meal.
    client, db = client_and_db
    client.delete("/meals/meal-1")
    assert ("meals", "eq", "user_id", USER_ID) in db.filters


def test_history_requires_authentication():
    assert TestClient(main.app).get("/meals?days=7").status_code in (401, 422)
