from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel

from deps import get_current_user_client
from barcode import BarcodeProduct, lookup_barcode
from fastapi import File, UploadFile

from foods import SavedFood
from label import read_label, per_100g
from vision import VisionError

router = APIRouter()


class FoodIn(BaseModel):
    name: str
    brand: str | None = None
    barcode: str | None = None
    kcal_per_100g: float
    protein_per_100g: float = 0
    carbs_per_100g: float = 0
    fat_per_100g: float = 0
    serving_grams: float = 100
    source: str = "manual"
    usda_fdc_id: int | None = None


@router.get("/foods", response_model=list[SavedFood])
def list_foods(user=Depends(get_current_user_client)):
    """This user's food library."""
    user_id, client = user
    rows = (
        client.table("saved_foods")
        .select("*")
        .eq("user_id", user_id)
        .order("name")
        .execute()
    ).data
    return [
        SavedFood(**{k: v for k, v in row.items() if k in SavedFood.model_fields})
        for row in rows
    ]


@router.post("/foods", response_model=SavedFood)
def save_food(body: FoodIn, user=Depends(get_current_user_client)):
    """Add a food, or update it if this user already has one by that name.

    Upsert rather than insert: saving the same food twice should correct it,
    not leave two entries that make matching ambiguous.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "A food needs a name")
    if body.kcal_per_100g < 0 or body.serving_grams <= 0:
        raise HTTPException(400, "Calories can't be negative and a serving can't be zero")

    user_id, client = user
    try:
        result = client.table("saved_foods").upsert(
            {**body.model_dump(), "name": name, "user_id": user_id},
            on_conflict="user_id,name",
        ).execute()
    except APIError as e:
        # Caught so the response keeps its CORS headers and the browser sees a
        # real status rather than a phantom CORS failure.
        raise HTTPException(400, f"Couldn't save that food: {e.message}")

    row = result.data[0]
    return SavedFood(**{k: v for k, v in row.items() if k in SavedFood.model_fields})


@router.delete("/foods/{food_id}")
def delete_food(food_id: str, user=Depends(get_current_user_client)):
    user_id, client = user
    client.table("saved_foods").delete().eq("user_id", user_id).eq("id", food_id).execute()
    return {"deleted": food_id}


@router.get("/barcode/{code}", response_model=BarcodeProduct)
def scan_barcode(code: str, user=Depends(get_current_user_client)):
    """Look up a scanned package.

    Returns a candidate for review, and stops there. Nothing is saved or logged
    from a scan -- a misread digit should be caught by a person, the same
    reason voice input fills a box instead of submitting.
    """
    product = lookup_barcode(code)
    if product is None:
        raise HTTPException(
            404, "No product found for that barcode. You can add it by hand instead."
        )
    return product


class LabelResult(BaseModel):
    """A nutrition panel, read off a photo and converted to per-100g."""

    product_name: str | None
    kcal_per_100g: float
    protein_per_100g: float
    carbs_per_100g: float
    fat_per_100g: float
    basis: str
    serving_grams: float | None


@router.post("/foods/label", response_model=LabelResult)
async def scan_label(image: UploadFile = File(...), user=Depends(get_current_user_client)):
    """Read a nutrition panel from a photo, for products no barcode lookup knows.

    Fills the form for review; nothing is saved from here. The model is
    transcribing printed numbers, not recalling what a product contains -- and
    the user checks them against the packet before they become anything.
    """
    try:
        label = read_label(await image.read(), image.content_type or "image/jpeg")
    except VisionError as e:
        raise HTTPException(502, str(e))

    macros = per_100g(label)
    if macros is None:
        raise HTTPException(
            422,
            "Couldn't read enough from that label. Make sure the calories and, if "
            "the panel is per serving, the serving weight are both in shot.",
        )

    return LabelResult(
        product_name=label.product_name,
        basis=label.basis,
        serving_grams=label.serving_grams,
        **macros,
    )
