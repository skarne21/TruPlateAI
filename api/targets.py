from pydantic import BaseModel, field_validator

ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

# Safe-rate caps: no crash-diet support (project-plan.md §3.1 onboarding presets).
MAX_LOSE_RATE_LB_PER_WEEK = 1.5
MAX_GAIN_RATE_LB_PER_WEEK = 0.5

# Grams of protein per kg bodyweight, by goal. Higher on a cut to preserve
# muscle during a deficit; standard sports-nutrition range is 1.6-2.2 g/kg.
PROTEIN_G_PER_KG = {
    "lose": 2.2,
    "recomp": 2.0,
    "gain": 1.8,
}

KCAL_PER_LB = 500  # ~3500 kcal/lb spread over 7 days ≈ 500 kcal/day


class TargetsInput(BaseModel):
    sex: str
    weight_kg: float
    height_cm: float
    age: int
    activity_level: str
    goal: str
    rate_lb_per_week: float

    @field_validator("rate_lb_per_week")
    @classmethod
    def validate_safe_rate(cls, v, info):
        goal = info.data.get("goal")
        if goal == "lose" and v > MAX_LOSE_RATE_LB_PER_WEEK:
            raise ValueError(f"rate exceeds safe cap of {MAX_LOSE_RATE_LB_PER_WEEK} lb/week")
        if goal == "gain" and v > MAX_GAIN_RATE_LB_PER_WEEK:
            raise ValueError(f"rate exceeds safe cap of {MAX_GAIN_RATE_LB_PER_WEEK} lb/week")
        return v


class TargetsResult(BaseModel):
    bmr: float
    tdee: float
    kcal_target: float
    protein_g: float
    explanation: str


def calculate_targets(profile: TargetsInput) -> TargetsResult:
    if profile.sex == "male":
        bmr = 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age + 5
    else:
        bmr = 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age - 161

    tdee = bmr * ACTIVITY_MULTIPLIERS[profile.activity_level]

    if profile.goal == "gain":
        kcal_target = tdee + profile.rate_lb_per_week * KCAL_PER_LB
    elif profile.goal == "lose":
        kcal_target = tdee - profile.rate_lb_per_week * KCAL_PER_LB
    else:
        kcal_target = tdee

    protein_g = profile.weight_kg * PROTEIN_G_PER_KG[profile.goal]

    explanation = (
        f"Maintenance is about {tdee:.0f} kcal/day; targeting {kcal_target:.0f} kcal "
        f"and {protein_g:.0f}g protein for your {profile.goal} goal."
    )

    return TargetsResult(
        bmr=bmr, tdee=tdee, kcal_target=kcal_target,
        protein_g=protein_g, explanation=explanation,
    )
