"""Barcode lookup for packaged food, via Open Food Facts.

Open Food Facts rather than USDA: it's free, needs no key, and its whole
purpose is barcodes. USDA's Branded dataset does carry GTIN codes, but those
are the rows the meal pipeline deliberately excludes, and its coverage of
non-US packaging is thin.

A scan produces a *candidate* food. The user reviews it and saves it to their
library -- nothing is logged straight off a barcode, for the same reason voice
input isn't: a misread number should be caught by a person, not turned into
calories.
"""

import requests
from pydantic import BaseModel

API_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"

# Open Food Facts asks callers to identify themselves rather than send a
# generic agent, so their traffic is attributable.
USER_AGENT = "TruPlateAI/0.1 (student nutrition project)"

FIELDS = "product_name,brands,nutriments"

# Real retail barcodes are EAN-8 through GTIN-14. Anything outside that is a
# misread, and looking it up risks hitting an unrelated product.
MIN_DIGITS = 8
MAX_DIGITS = 14

TIMEOUT_SECONDS = 10


class BarcodeProduct(BaseModel):
    """A scanned product, shaped to drop straight into the food library."""

    barcode: str
    name: str
    brand: str | None = None
    kcal_per_100g: float
    protein_per_100g: float = 0
    carbs_per_100g: float = 0
    fat_per_100g: float = 0


def normalize_barcode(raw: str) -> str | None:
    """Digits only, or None if this can't be a barcode.

    Scanners and hand-typing both introduce spaces and dashes.
    """
    digits = "".join(c for c in str(raw or "") if c.isdigit())
    if not digits or len(digits) < MIN_DIGITS or len(digits) > MAX_DIGITS:
        return None
    if len(digits) != len("".join(str(raw or "").split()).replace("-", "")):
        # Contained something that wasn't a digit, space or dash.
        return None
    return digits


def parse_product(payload: dict, barcode: str) -> BarcodeProduct | None:
    """Turn an Open Food Facts response into a food, or None if unusable."""
    if payload.get("status") != 1:
        return None

    product = payload.get("product") or {}
    name = (product.get("product_name") or "").strip()
    if not name:
        return None

    nutriments = product.get("nutriments") or {}
    kcal = nutriments.get("energy-kcal_100g")
    if kcal is None:
        # The product exists but carries no nutrition data. Saving it would put
        # a 0 kcal food in the library, which then silently under-counts every
        # meal it appears in.
        return None

    def number(key: str) -> float:
        value = nutriments.get(key)
        return float(value) if isinstance(value, (int, float)) else 0.0

    return BarcodeProduct(
        barcode=barcode,
        name=name,
        brand=(product.get("brands") or "").split(",")[0].strip() or None,
        kcal_per_100g=float(kcal),
        protein_per_100g=number("proteins_100g"),
        carbs_per_100g=number("carbohydrates_100g"),
        fat_per_100g=number("fat_100g"),
    )


def lookup_barcode(raw: str) -> BarcodeProduct | None:
    """Look up a scanned barcode. None for anything unusable."""
    code = normalize_barcode(raw)
    if code is None:
        return None

    try:
        response = requests.get(
            API_URL.format(barcode=code),
            params={"fields": FIELDS},
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return parse_product(response.json(), code)
    except (requests.RequestException, ValueError):
        # Unreachable or unparseable. The user can still type the numbers in.
        return None
