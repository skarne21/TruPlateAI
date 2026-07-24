import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

import usda
from analysis import (
    ResolvedItem,
    apply_fat_answer,
    apply_portion_answer,
    canonical_questions,
    resolve_items,
    totals_for,
)
from deps import get_current_user_client
from routes.profile import load_profile_row
from vision import FatAnswer, VisionError, analyze_meal, build_prompt, identify_fat_from_photo

router = APIRouter()

MAX_IMAGES = 5


class AnalyzeResult(BaseModel):
    meal_summary: str
    input_mode: str
    items: list[ResolvedItem]
    questions: list[dict]
    totals: dict[str, float]
    warnings: list[str]
    analysis_json: dict


@router.post("/analyze", response_model=AnalyzeResult)
async def analyze(
    images: list[UploadFile] = File(default=[]),
    caption: str | None = Form(default=None),
    user=Depends(get_current_user_client),
):
    """Photo(s) and/or text -> identified foods priced from USDA.

    Several photos are treated as several views of ONE meal, not several meals.
    """
    caption = (caption or "").strip()
    # UploadFile entries with no filename are empty slots from the browser.
    images = [f for f in images if f.filename][:MAX_IMAGES]

    if not images and not caption:
        raise HTTPException(400, "Send at least one photo or a caption")

    user_id, client = user
    profile = load_profile_row(client, user_id)

    input_mode = "photo_text" if images and caption else ("photo" if images else "text")
    prompt = build_prompt(profile)
    if caption:
        prompt += f'\n\nThe user described this meal as: "{caption}"'
    prompt += f'\n\nSet "input_mode" to "{input_mode}".'

    payload = [(await f.read(), f.content_type or "image/jpeg") for f in images]

    try:
        analysis = analyze_meal(prompt, images=payload)
    except VisionError as e:
        # Surfaced to the user as a visible error with their draft intact --
        # a failed analysis must never silently drop a meal.
        raise HTTPException(502, f"Couldn't read that meal: {e}")

    items = resolve_items(analysis)
    return AnalyzeResult(
        meal_summary=analysis.meal_summary,
        input_mode=input_mode,
        items=items,
        questions=canonical_questions(analysis),
        totals=totals_for(items),
        warnings=analysis.warnings,
        analysis_json=analysis.model_dump(),
    )


class ClarifyIn(BaseModel):
    items: list[ResolvedItem]
    reason: str
    option_index: int | None = None
    item_name: str | None = None
    # Set when a photo of the oil identified the fat (and possibly the amount).
    fat_name: str | None = None
    grams: float | None = None


class ClarifyResult(BaseModel):
    items: list[ResolvedItem]
    totals: dict[str, float]


@router.post("/analyze/clarify", response_model=ClarifyResult)
def clarify(body: ClarifyIn, user=Depends(get_current_user_client)):
    """Apply a clarifying answer. Pure arithmetic -- no LLM call here."""
    if body.reason == "hidden_fat":
        if body.option_index is None and body.grams is None:
            raise HTTPException(400, "Need an option or an amount")
        items = apply_fat_answer(
            body.items,
            option_index=body.option_index or 0,
            fat_name=body.fat_name or "vegetable oil",
            grams=body.grams,
        )
    elif body.reason == "portion":
        if body.option_index is None or not body.item_name:
            raise HTTPException(400, "Need an item and an option")
        items = apply_portion_answer(body.items, body.item_name, body.option_index)
    else:
        raise HTTPException(400, f"Unsupported question reason: {body.reason}")

    return ClarifyResult(items=items, totals=totals_for(items))


@router.post("/analyze/fat-photo", response_model=FatAnswer)
async def fat_photo(image: UploadFile = File(...), user=Depends(get_current_user_client)):
    """Read the fat type (and amount, if visible) from a photo of the oil used.

    Returns the identification only; the client shows it, then applies it via
    /analyze/clarify. A null `grams` means the photo showed what but not how
    much, and the amount options stay on screen.
    """
    try:
        return identify_fat_from_photo(await image.read(), image.content_type or "image/jpeg")
    except VisionError as e:
        raise HTTPException(502, str(e))


class UsdaCandidate(BaseModel):
    fdc_id: int
    description: str
    data_type: str
    kcal_per_100g: float | None
    protein_per_100g: float | None


@router.get("/usda/search", response_model=list[UsdaCandidate])
def usda_search(query: str, user=Depends(get_current_user_client)):
    """Candidate foods for the add/rename-item flow on the confirm screen."""
    try:
        foods = usda.search_food(query)
    except requests.RequestException as e:
        # Raised as a real HTTPException so the response keeps its CORS headers
        # and the browser sees 502 rather than a phantom CORS failure.
        raise HTTPException(502, f"USDA lookup is unavailable right now: {e}")

    candidates = []
    for food in foods:
        if food.get("dataType") == "Branded":
            continue
        macros = usda.macros_for_grams(food, 100)
        candidates.append(UsdaCandidate(
            fdc_id=food["fdcId"],
            description=food["description"],
            data_type=food["dataType"],
            kcal_per_100g=macros["kcal"],
            protein_per_100g=macros["protein_g"],
        ))
    return candidates[:10]
