"""A user's own food library: things they've defined, scanned, or corrected.

This is the answer to the gap USDA leaves. USDA has no *poha*, so it matches a
groundcherry entry that happens to share the word -- and no amount of smarter
matching fixes a food that simply isn't in the database. Saving it once makes
it right permanently, for this user, and it takes precedence over USDA
everywhere.

Numbers here come from USDA, a barcode lookup, or the user typing them. They
never come from the model.
"""

from pydantic import BaseModel


class SavedFood(BaseModel):
    id: str
    name: str
    brand: str | None = None
    barcode: str | None = None
    kcal_per_100g: float
    protein_per_100g: float
    carbs_per_100g: float
    fat_per_100g: float
    # What the user considers one serving. A plate of poha is 250g, not 100g,
    # and making them do that arithmetic every time defeats the point.
    serving_grams: float = 100.0
    source: str = "manual"  # manual | usda | barcode


def normalize_name(name: str) -> str:
    """Canonical form for comparing food names.

    Case and spacing are collapsed, and a trailing "s" is dropped so the
    model saying "idlis" still finds a saved "idli". Deliberately no fuzzier
    than that: substituting somebody's saved food for a merely similar one
    would put the wrong numbers in their log without telling them.
    """
    cleaned = " ".join(str(name or "").lower().split())
    if len(cleaned) > 3 and cleaned.endswith("s") and not cleaned.endswith("ss"):
        cleaned = cleaned[:-1]
    return cleaned


def match_saved_food(
    name: str, usda_query: str, library: list[SavedFood]
) -> SavedFood | None:
    """Find the user's own version of a food, if they have one.

    Tries the item's name and its search phrase, because the model may name a
    dish loosely while producing a precise query, or the reverse.
    """
    wanted = {normalize_name(name), normalize_name(usda_query)} - {""}
    for food in library:
        if normalize_name(food.name) in wanted:
            return food
    return None


def macros_for_portion(food: SavedFood, grams: float) -> dict[str, float]:
    """Scale a saved food's per-100g numbers to an actual portion."""
    scale = grams / 100.0
    return {
        "kcal": food.kcal_per_100g * scale,
        "protein_g": food.protein_per_100g * scale,
        "carbs_g": food.carbs_per_100g * scale,
        "fat_g": food.fat_per_100g * scale,
    }


def load_library(client, user_id: str) -> list[SavedFood]:
    """Every food this user has saved. Empty on any failure -- the library is
    an improvement on USDA, never a prerequisite for logging."""
    try:
        rows = (
            client.table("saved_foods")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        ).data
    except Exception:
        return []
    return [SavedFood(**{k: v for k, v in row.items() if k in SavedFood.model_fields})
            for row in rows]
