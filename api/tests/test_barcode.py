import pytest
import requests

import barcode
from barcode import BarcodeProduct, normalize_barcode, parse_product


def off_payload(**nutriments):
    return {
        "status": 1,
        "product": {
            "product_name": "Nutella",
            "brands": "Ferrero",
            "nutriments": {
                "energy-kcal_100g": 539, "proteins_100g": 6.3,
                "carbohydrates_100g": 57.5, "fat_100g": 30.9, **nutriments,
            },
        },
    }


# --- reading the barcode itself --------------------------------------------

def test_spaces_and_dashes_are_stripped():
    assert normalize_barcode(" 5449-0000 00996 ") == "5449000000996"


def test_a_barcode_must_be_digits():
    assert normalize_barcode("abc123") is None
    assert normalize_barcode("") is None


def test_implausible_lengths_are_rejected():
    # Real barcodes are 8 to 14 digits. Anything else is a misread, and looking
    # it up would either miss or -- worse -- hit an unrelated product.
    assert normalize_barcode("123") is None
    assert normalize_barcode("1" * 20) is None
    assert normalize_barcode("12345678") == "12345678"


# --- turning a response into a food ----------------------------------------

def test_a_product_becomes_a_saveable_food():
    product = parse_product(off_payload(), "3017620422003")
    assert product.name == "Nutella"
    assert product.brand == "Ferrero"
    assert product.barcode == "3017620422003"
    assert product.kcal_per_100g == pytest.approx(539)
    assert product.protein_per_100g == pytest.approx(6.3)


def test_an_unknown_barcode_yields_nothing():
    assert parse_product({"status": 0}, "0000000000000") is None


def test_a_product_with_no_calories_is_rejected():
    # A record exists but has no nutrition data. Saving it would put a food
    # with 0 kcal into the library, which then silently under-counts meals.
    payload = off_payload()
    del payload["product"]["nutriments"]["energy-kcal_100g"]
    assert parse_product(payload, "123") is None


def test_missing_macros_default_to_zero_but_calories_never_do():
    payload = off_payload()
    del payload["product"]["nutriments"]["proteins_100g"]
    product = parse_product(payload, "123")
    assert product.protein_per_100g == 0
    assert product.kcal_per_100g == pytest.approx(539)


def test_a_nameless_product_is_rejected():
    payload = off_payload()
    payload["product"]["product_name"] = ""
    assert parse_product(payload, "123") is None


# --- the lookup ------------------------------------------------------------

def test_lookup_returns_none_when_the_service_is_down(monkeypatch):
    def broken(*a, **k):
        raise requests.ConnectionError("offline")

    monkeypatch.setattr(barcode.requests, "get", broken)
    assert barcode.lookup_barcode("5449000000996") is None


def test_lookup_rejects_a_bad_barcode_without_calling_out(monkeypatch):
    called = []
    monkeypatch.setattr(barcode.requests, "get", lambda *a, **k: called.append(1))
    assert barcode.lookup_barcode("nope") is None
    assert called == []
