import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from deps import get_current_user_client
from targets import TargetsInput, calculate_targets, TargetsResult

app = FastAPI(title="TruPlate AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


class ProfileIn(TargetsInput):
    cuisines: list[str] = []
    budget_level: str | None = None
    exclusions: list[str] = []


@app.post("/profile", response_model=TargetsResult)
def create_profile(body: ProfileIn, user=Depends(get_current_user_client)):
    user_id, client = user
    result = calculate_targets(body)
    client.table("profiles").upsert({
        "user_id": user_id,
        "goal": body.goal,
        "rate_lb_per_week": body.rate_lb_per_week,
        "gym_days": 0,
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


@app.get("/profile", response_model=TargetsResult)
def get_profile(user=Depends(get_current_user_client)):
    user_id, client = user
    row = client.table("profiles").select("*").eq("user_id", user_id).single().execute()
    profile = TargetsInput(**row.data)
    return calculate_targets(profile)
