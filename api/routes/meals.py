from datetime import date, timedelta

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

    client.table("meal_items").insert(
        [_item_row(meal_id, user_id, item) for item in body.items]
    ).execute()

    _remember(client, user_id, meal_id, body.items, body.caption, body.analysis_json)
    return LogResult(meal_id=meal_id, totals=totals)


def _item_row(meal_id: str, user_id: str, item: ResolvedItem) -> dict:
    """One meal_items row. Shared by logging and editing so a column added to
    one can't be forgotten in the other."""
    return {
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


def _remember(
    client,
    user_id: str,
    meal_id: str,
    items: list[ResolvedItem],
    caption: str | None,
    analysis_json: dict | None,
) -> None:
    """Store an embedding so this meal can be recognised next time.

    Runs after the meal is safely saved, and swallows its own failures: meal
    memory is a convenience, and losing a real logged meal because an optional
    feature broke would be a straight downgrade.
    """
    # Two different strings on purpose: the readable one is shown back to the
    # user, the signature is what gets embedded. The model's prose wraps every
    # meal in the same boilerplate, which pulls unrelated meals together.
    summary = (
        (analysis_json or {}).get("meal_summary")
        or caption
        or ", ".join(item.name for item in items)
    )
    embedding = embed_meal(meal_signature([item.name for item in items]))
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


# How far back history can reach. Generous enough to review a month, bounded so
# a stray query can't ask for everything ever logged.
MAX_HISTORY_DAYS = 90


class LoggedItem(BaseModel):
    name: str
    grams: float
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    source: str | None = None
    usda_description: str | None = None
    # Everything below exists so a meal can be sent back for editing exactly as
    # it was stored. Without them an edit would silently drop the USDA match
    # and reset confidence, which is how a corrected meal becomes a worse one.
    usda_query: str | None = None
    count: float | None = None
    unit: str | None = None
    usda_fdc_id: int | None = None
    confidence: float | None = None


class LoggedMeal(BaseModel):
    id: str
    logged_on: date
    input_mode: str
    caption: str | None = None
    photo_paths: list[str] = []
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    items: list[LoggedItem] = []


@router.get("/meals", response_model=list[LoggedMeal])
def list_meals(days: int = 7, user=Depends(get_current_user_client)):
    """Meals logged recently, newest first, with the items that made them up.

    Items rather than totals alone: a total can't be checked against a weighed
    plate, and reviewing what was actually recorded is the whole point of
    being able to look back.
    """
    window = max(1, min(int(days), MAX_HISTORY_DAYS))
    user_id, client = user
    start = date.today() - timedelta(days=window - 1)

    rows = (
        client.table("meals")
        .select("id, logged_on, input_mode, caption, photo_paths, kcal, protein_g, "
                "carbs_g, fat_g, meal_items(name, grams, kcal, protein_g, carbs_g, "
                "fat_g, source, usda_description, usda_query, count, unit, "
                "usda_fdc_id, confidence)")
        .eq("user_id", user_id)
        .eq("status", "confirmed")
        .gte("logged_on", start.isoformat())
        .order("logged_at", desc=True)
        .execute()
    ).data

    return [
        LoggedMeal(
            id=row["id"],
            logged_on=date.fromisoformat(row["logged_on"]),
            input_mode=row.get("input_mode") or "text",
            caption=row.get("caption"),
            photo_paths=row.get("photo_paths") or [],
            kcal=row.get("kcal"), protein_g=row.get("protein_g"),
            carbs_g=row.get("carbs_g"), fat_g=row.get("fat_g"),
            items=[LoggedItem(**item) for item in (row.get("meal_items") or [])],
        )
        for row in rows
    ]


class EditIn(BaseModel):
    items: list[ResolvedItem]
    caption: str | None = None


@router.patch("/meals/{meal_id}", response_model=LogResult)
def edit_meal(meal_id: str, body: EditIn, user=Depends(get_current_user_client)):
    """Correct a meal that is already logged.

    Deleting and re-logging would have needed no new endpoint, but it loses the
    photos and the original date, and a failure between the two steps loses the
    meal outright -- which is the one thing this app promises never to do.

    Items are replaced wholesale rather than diffed: the client already holds
    the whole list, so a replace has no partial-update states to get wrong.
    Totals are re-summed here for the same reason as on /log -- a client is not
    a trusted source of arithmetic.
    """
    user_id, client = user

    if not body.items:
        raise HTTPException(400, "A meal needs at least one item")

    # Ownership first, and by select rather than by trusting the later writes:
    # a guessed id from another account must not delete their meal_items on the
    # way to finding out it was never ours.
    owned = (
        client.table("meals")
        .select("id")
        .eq("id", meal_id)
        .eq("user_id", user_id)
        .execute()
    ).data
    if not owned:
        raise HTTPException(404, "No such meal")

    totals = totals_for(body.items)

    # ponytail: three writes, no transaction -- supabase-py has none, so a
    # failure mid-way leaves items and totals disagreeing until the next edit.
    # The order puts the single-row update last so the window is as small as
    # possible; wrap it in a Postgres function if this ever needs to be atomic.
    client.table("meal_items").delete().eq("meal_id", meal_id).eq("user_id", user_id).execute()
    client.table("meal_items").insert(
        [_item_row(meal_id, user_id, item) for item in body.items]
    ).execute()
    client.table("meals").update({"caption": body.caption, **totals}).eq(
        "id", meal_id
    ).eq("user_id", user_id).execute()

    # Re-embedding is the whole point of letting people correct a meal: what
    # gets recognised next time has to be the fixed numbers, not the wrong ones.
    _remember(client, user_id, meal_id, body.items, body.caption, None)
    return LogResult(meal_id=meal_id, totals=totals)


@router.delete("/meals/{meal_id}")
def delete_meal(meal_id: str, user=Depends(get_current_user_client)):
    """Remove a logged meal.

    Scoped to the caller, so a guessed id can't reach another account's meal.
    The items and the memory embedding go with it -- both cascade from the
    meals row -- so a deleted meal stops affecting today's totals AND stops
    being offered as "your usual".
    """
    user_id, client = user
    client.table("meals").delete().eq("user_id", user_id).eq("id", meal_id).execute()
    return {"deleted": meal_id}
