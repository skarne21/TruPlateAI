from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from adaptive import (
    DayIntake,
    WeighIn,
    ema_series,
    recommend_target,
)
from deps import get_current_user_client
from routes.profile import load_profile_row
from targets import TargetsInput, calculate_targets

router = APIRouter()

# How far back the engine looks. Long enough to reach full trust in observed
# TDEE (28 days) with room to spare.
WINDOW_DAYS = 42


class WeighInIn(BaseModel):
    weight_kg: float
    measured_on: date


class WeightPoint(BaseModel):
    measured_on: date
    weight_kg: float
    ema_kg: float


class TargetOut(BaseModel):
    kcal: float
    protein_g: float
    source: str
    explanation: str
    effective_date: date


class WeighInResult(BaseModel):
    target: TargetOut
    adjusted: bool
    observed_tdee: float | None
    observed_rate_lb_per_week: float | None
    days_of_data: int


def _history(client, user_id: str, today: date):
    """Weigh-ins and per-day intake over the window. Plain SQL, never an LLM."""
    start = today - timedelta(days=WINDOW_DAYS - 1)

    weight_rows = (
        client.table("weights")
        .select("measured_on, weight_kg")
        .eq("user_id", user_id)
        .gte("measured_on", start.isoformat())
        .lte("measured_on", today.isoformat())
        .order("measured_on")
        .execute()
    ).data
    weighs = [
        WeighIn(measured_on=date.fromisoformat(r["measured_on"]), weight_kg=float(r["weight_kg"]))
        for r in weight_rows
    ]

    meal_rows = (
        client.table("meals")
        .select("logged_on, kcal")
        .eq("user_id", user_id)
        .eq("status", "confirmed")
        .gte("logged_on", start.isoformat())
        .lte("logged_on", today.isoformat())
        .execute()
    ).data
    by_day: dict[date, float] = {}
    for row in meal_rows:
        day = date.fromisoformat(row["logged_on"])
        by_day[day] = by_day.get(day, 0.0) + float(row.get("kcal") or 0.0)
    intakes = [DayIntake(day=d, kcal=k) for d, k in sorted(by_day.items())]

    return weighs, intakes


def _current_target(client, user_id: str, profile: dict) -> TargetOut:
    """Latest stored target, falling back to the formula for a new user."""
    rows = (
        client.table("targets")
        .select("kcal, protein_g, source, explanation, effective_date")
        .eq("user_id", user_id)
        .order("effective_date", desc=True)
        .limit(1)
        .execute()
    ).data
    if rows:
        row = rows[0]
        return TargetOut(
            kcal=float(row["kcal"]), protein_g=float(row["protein_g"]),
            source=row["source"], explanation=row["explanation"],
            effective_date=date.fromisoformat(row["effective_date"]),
        )

    computed = calculate_targets(TargetsInput(**profile))
    return TargetOut(
        kcal=computed.kcal_target, protein_g=computed.protein_g,
        source="formula", explanation=computed.explanation,
        effective_date=date.today(),
    )


@router.get("/targets/current", response_model=TargetOut)
def current_target(user=Depends(get_current_user_client)):
    user_id, client = user
    return _current_target(client, user_id, load_profile_row(client, user_id))


@router.get("/targets/history", response_model=list[TargetOut])
def target_history(user=Depends(get_current_user_client)):
    """Every change with the reason for it, newest first."""
    user_id, client = user
    rows = (
        client.table("targets")
        .select("kcal, protein_g, source, explanation, effective_date")
        .eq("user_id", user_id)
        .order("effective_date", desc=True)
        .execute()
    ).data
    return [
        TargetOut(
            kcal=float(r["kcal"]), protein_g=float(r["protein_g"]), source=r["source"],
            explanation=r["explanation"], effective_date=date.fromisoformat(r["effective_date"]),
        )
        for r in rows
    ]


@router.get("/weights", response_model=list[WeightPoint])
def list_weights(user=Depends(get_current_user_client)):
    """The weigh-in series with its smoothed trend, for the chart."""
    user_id, client = user
    weighs, _ = _history(client, user_id, date.today())
    smoothed = ema_series([w.weight_kg for w in weighs])
    return [
        WeightPoint(measured_on=w.measured_on, weight_kg=w.weight_kg, ema_kg=e)
        for w, e in zip(weighs, smoothed)
    ]


@router.post("/weights", response_model=WeighInResult)
def add_weight(body: WeighInIn, user=Depends(get_current_user_client)):
    """Record a weigh-in, then let the engine decide if the target should move."""
    if body.weight_kg <= 0:
        raise HTTPException(400, "Weight must be positive")

    user_id, client = user
    profile = load_profile_row(client, user_id)

    # Re-weighing on the same day replaces the reading rather than adding one.
    client.table("weights").upsert(
        {"user_id": user_id, "weight_kg": body.weight_kg,
         "measured_on": body.measured_on.isoformat()},
        on_conflict="user_id,measured_on",
    ).execute()

    current = _current_target(client, user_id, profile)
    weighs, intakes = _history(client, user_id, body.measured_on)
    formula = calculate_targets(TargetsInput(**profile))

    result = recommend_target(
        current_kcal=current.kcal,
        target_rate_lb_per_week=float(profile["rate_lb_per_week"]),
        formula_tdee=formula.tdee,
        weights=weighs,
        intakes=intakes,
    )

    target = current
    if result.adjusted:
        # Stored as a new row, never an update: the history is what lets the
        # user see why their number moved.
        client.table("targets").insert({
            "user_id": user_id,
            "effective_date": body.measured_on.isoformat(),
            "kcal": result.new_kcal,
            "protein_g": formula.protein_g,
            "source": "adaptive",
            "explanation": result.explanation,
        }).execute()
        target = TargetOut(
            kcal=result.new_kcal, protein_g=formula.protein_g, source="adaptive",
            explanation=result.explanation, effective_date=body.measured_on,
        )

    return WeighInResult(
        target=target,
        adjusted=result.adjusted,
        observed_tdee=result.observed_tdee,
        observed_rate_lb_per_week=result.observed_rate_lb_per_week,
        days_of_data=result.days_of_data,
    )
