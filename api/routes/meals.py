from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from analysis import ResolvedItem, totals_for
from deps import get_current_user_client
from memory import embed_meal, meal_signature
from routes.profile import load_profile_row
from routes.weights import _current_target
from targets import TargetsInput, calculate_targets

router = APIRouter()


class LogIn(BaseModel):
    items: list[ResolvedItem]
    input_mode: str
    logged_on: date  # the client's LOCAL date; the server does no timezone math
    caption: str | None = None
    photo_paths: list[str] = []
    analysis_json: dict | None = None


class LogResult(BaseModel):
    meal_id: str
    totals: dict[str, float]


@router.post("/log", response_model=LogResult)
def log_meal(body: LogIn, user=Depends(get_current_user_client)):
    user_id, client = user

    if not body.items:
        raise HTTPException(400, "A meal needs at least one item")

    # A client is not a trusted source of arithmetic -- totals are always summed
    # here from the submitted items, never accepted from the request.
    totals = totals_for(body.items)

    # Photos live under meal-photos/{user_id}/..., so a path claiming another
    # user's prefix is junk data even though storage RLS would block reading it.
    for path in body.photo_paths:
        if not path.startswith(f"{user_id}/"):
            raise HTTPException(400, "Photo path does not belong to this user")

    meal = client.table("meals").insert({
        "user_id": user_id,
        "logged_on": body.logged_on.isoformat(),
        "input_mode": body.input_mode,
        "photo_paths": body.photo_paths,
        "caption": body.caption,
        "status": "confirmed",
        "analysis_json": body.analysis_json,
        **totals,
    }).execute()
    meal_id = meal.data[0]["id"]

    client.table("meal_items").insert([
        {
            "meal_id": meal_id,
            "user_id": user_id,
            "name": item.name,
            "usda_query": item.usda_query,
            "grams": item.grams,
            "count": item.count,
            "unit": item.unit,
            "source": item.source,
            "usda_fdc_id": item.usda_fdc_id,
            "usda_description": item.usda_description,
            "kcal": item.kcal,
            "protein_g": item.protein_g,
            "carbs_g": item.carbs_g,
            "fat_g": item.fat_g,
            "confidence": item.confidence,
        }
        for item in body.items
    ]).execute()

    _remember(client, user_id, meal_id, body)
    return LogResult(meal_id=meal_id, totals=totals)


def _remember(client, user_id: str, meal_id: str, body: LogIn) -> None:
    """Store an embedding so this meal can be recognised next time.

    Runs after the meal is safely saved, and swallows its own failures: meal
    memory is a convenience, and losing a real logged meal because an optional
    feature broke would be a straight downgrade.
    """
    # Two different strings on purpose: the readable one is shown back to the
    # user, the signature is what gets embedded. The model's prose wraps every
    # meal in the same boilerplate, which pulls unrelated meals together.
    summary = (
        (body.analysis_json or {}).get("meal_summary")
        or body.caption
        or ", ".join(item.name for item in body.items)
    )
    embedding = embed_meal(meal_signature([item.name for item in body.items]))
    if not embedding:
        return
    try:
        client.table("meal_embeddings").upsert({
            "meal_id": meal_id, "user_id": user_id,
            "summary": summary, "embedding": embedding,
        }).execute()
    except Exception:
        pass


class DayTotals(BaseModel):
    date: date
    consumed: dict[str, float]
    targets: dict[str, float]
    remaining: dict[str, float]
    meal_count: int


@router.get("/dashboard/today", response_model=DayTotals)
def dashboard_today(date: date, user=Depends(get_current_user_client)):
    """Consumed vs. target for one local calendar day. Plain SQL, never an LLM."""
    user_id, client = user

    rows = (
        client.table("meals")
        .select("kcal, protein_g, carbs_g, fat_g")
        .eq("user_id", user_id)
        .eq("logged_on", date.isoformat())
        .eq("status", "confirmed")
        .execute()
    ).data

    consumed = {
        key: sum(row.get(key) or 0.0 for row in rows)
        for key in ("kcal", "protein_g", "carbs_g", "fat_g")
    }

    # The latest stored target, which is the adaptive one once the engine has
    # produced any. Falls back to the formula for a user with no history --
    # otherwise the adaptive number would never reach the dashboard.
    current = _current_target(client, user_id, load_profile_row(client, user_id))
    targets = {"kcal": current.kcal, "protein_g": current.protein_g}

    return DayTotals(
        date=date,
        consumed=consumed,
        targets=targets,
        remaining={key: targets[key] - consumed[key] for key in targets},
        meal_count=len(rows),
    )
