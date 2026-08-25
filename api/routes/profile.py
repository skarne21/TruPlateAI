from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from deps import get_current_user_client
from targets import TargetsInput, TargetsResult, calculate_targets

router = APIRouter()


class ProfileIn(TargetsInput):
    gym_days: int = 0
    cuisines: list[str] = []
    budget_level: str | None = None
    exclusions: list[str] = []


@router.post("/profile", response_model=TargetsResult)
def create_profile(body: ProfileIn, user=Depends(get_current_user_client)):
    user_id, client = user
    result = calculate_targets(body)
    client.table("profiles").upsert({
        "user_id": user_id,
        "goal": body.goal,
        "rate_lb_per_week": body.rate_lb_per_week,
        "gym_days": body.gym_days,
        "activity_level": body.activity_level,
        "height_cm": body.height_cm,
        "weight_kg": body.weight_kg,
        "age": body.age,
        "sex": body.sex,
        "cuisines": body.cuisines,
        "budget_level": body.budget_level,
        "exclusions": body.exclusions,
    }).execute()
    return result


@router.get("/profile", response_model=TargetsResult)
def get_profile(user=Depends(get_current_user_client)):
    user_id, client = user
    profile = load_profile_row(client, user_id)
    return calculate_targets(TargetsInput(**profile))


class ProfileOut(ProfileIn):
    """The stored profile itself, for a settings screen to edit.

    Separate from GET /profile, which returns computed *targets*. A settings
    page needs the raw answers back so it can show what was chosen -- goals,
    cuisines and especially exclusions all change over time, and until now
    there was no way to change any of them after signing up.
    """


@router.get("/profile/settings", response_model=ProfileOut)
def get_profile_settings(user=Depends(get_current_user_client)):
    user_id, client = user
    row = load_profile_row(client, user_id)
    return ProfileOut(**{k: v for k, v in row.items() if k in ProfileOut.model_fields})


def load_profile_row(client, user_id: str) -> dict:
    """Fetch the caller's profile row, or 404 if they haven't onboarded.

    Shared with the analyze routes, which need cuisines/exclusions to build the
    vision prompt.
    """
    try:
        row = client.table("profiles").select("*").eq("user_id", user_id).single().execute()
    except APIError as e:
        # PGRST116 = .single() got zero rows -- user hasn't onboarded yet.
        # Must be caught: an unhandled exception escapes past CORSMiddleware and
        # the browser reports it as a misleading CORS failure.
        if e.code == "PGRST116":
            raise HTTPException(404, "Profile not found")
        raise
    return row.data
