"""Gemini meal analysis: photo and/or text -> structured food identification.

The model identifies foods and portions only. Macro numbers come from USDA
(CLAUDE.md invariant #1), and every call is stateless (invariant #4).
"""

import os

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
import models
from pydantic import BaseModel, ValidationError



class VisionError(Exception):
    """Gemini could not be reached, or returned output we couldn't validate."""


def friendly_genai_error(exc: Exception) -> str:
    """Turn a raw Gemini failure into something worth showing a user.

    The raw text is a wall of JSON quoting internal quota metric names, which
    is useless to a user and alarming to look at. Shared by the vision pipeline
    and the Coach so both fail the same way.
    """
    if isinstance(exc, genai_errors.ServerError):
        return "The AI service is busy right now. Try again in a moment."
    if isinstance(exc, genai_errors.ClientError) and getattr(exc, "code", None) == 429:
        return "The AI service has hit its usage limit for now. Try again shortly."
    return "The AI service couldn't handle that request. Try again in a moment."


def _generate(client: genai.Client, contents: list, config) -> types.GenerateContentResponse:
    """Call Gemini, turning transport failures into VisionError.

    Gemini answers 503 UNAVAILABLE whenever the model is busy, and 429 once a
    quota runs out. Left unhandled either escapes the route as a bare 500 --
    and because Starlette's error handler sits OUTSIDE CORSMiddleware, the
    response carries no CORS headers and the browser reports a misleading
    "blocked by CORS policy" instead of the real cause. Every non-streaming
    Gemini call goes through here; the streaming one in chat.py uses
    friendly_genai_error for the same reason.
    """
    try:
        return client.models.generate_content(model=models.VISION, contents=contents, config=config)
    except genai_errors.APIError as exc:
        raise VisionError(friendly_genai_error(exc)) from exc


class Portion(BaseModel):
    count: float
    unit: str
    grams: float


class LlmEstimate(BaseModel):
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float


class VisionItem(BaseModel):
    name: str
    usda_query: str
    portion: Portion
    confidence: float
    prep_flags: list[str] = []
    llm_estimate: LlmEstimate


class ClarifyingQuestion(BaseModel):
    id: str
    question: str
    options: list[str] = []
    affects_items: list[str] = []
    reason: str
    kcal_impact: str = ""


class VisionAnalysis(BaseModel):
    meal_summary: str
    overall_confidence: float
    input_mode: str
    items: list[VisionItem]
    clarifying_questions: list[ClarifyingQuestion] = []
    warnings: list[str] = []


class FatAnswer(BaseModel):
    """A hidden-fat question answered with a photo instead of a tapped option."""

    # None when the photo contains no cooking fat at all. Without an explicit
    # "not found" signal the model writes its refusal into the name and the UI
    # renders "Found no fat detected in your photo".
    fat_name: str | None  # becomes the usda_query, e.g. "ghee", "olive oil"
    grams: float | None  # None when the photo shows the type but not the amount
    confidence: float


PROMPT_TEMPLATE = """\
You are a food-identification engine for a nutrition tracking app. You receive
one or more meal photos, a text description, or both (at least one is always
present), plus a user profile. You output ONLY valid JSON matching the schema.

USER PROFILE
- Cuisines frequently eaten: {cuisines}
- Dietary exclusions: {exclusions}
- Frequent restaurants: {restaurants}
- Known meals (from meal memory): {known_meals}

MULTIPLE PHOTOS
If several photos are provided they all show THE SAME meal, from different
angles or distances. Identify each distinct food ONCE. Never multiply portions
by the number of photos. Use the extra angles to refine portion estimates and
to identify items obscured in another shot.

YOUR JOB
1. Identify each distinct food item. Use the cuisine list to disambiguate
   visually similar dishes (sambar vs. generic soup, dosa vs. crepe, curd rice
   vs. risotto).
2. Estimate portion per item in grams, using visible references (plate ~27cm,
   fork, hand). State the count and unit too (e.g. 3 pieces).
3. For each item produce a `usda_query`: a plain-English search string for the
   USDA FoodData Central database ("dosa plain rice crepe", not "yummy dosa").
4. Provide your own macro estimate per item as `llm_estimate`. This is a
   fallback used only when the USDA match is poor -- it is never the primary
   number.
5. If both photos and a caption are present, treat the caption as strong
   evidence but verify it against the images; note disagreements in `warnings`.
   Never require a caption.

TEXT-ONLY MODE (no photo)
Parse foods and quantities from the description. Explicit quantities ("2
idlis") are used at high confidence. Unstated portions get a standard single
serving, that item's confidence capped at 0.6, and a portion question if the
ambiguity is worth more than 75 kcal.

CLARIFYING QUESTIONS -- ask ONLY when they materially change the estimate. Max 3.
Ask when:
- HIDDEN-FAT RULE: the dish plausibly contains invisible cooking fat (ghee, oil,
  butter, cream) -- curries, dals, sabzis, stir-fries, fried items, sauces. This
  is mandatory for home-cooked dishes from the user's cuisines. Set
  `reason` to "hidden_fat".
- Portion is genuinely ambiguous in a way worth more than 75 kcal. Set `reason`
  to "portion".
Do NOT ask when:
- The dish matches a frequent restaurant: apply standard restaurant oil
  assumptions, skip the fat question, and add a `warnings` entry saying so.
- The answer would not change macros meaningfully.

EXCLUSION CHECK: if you identify a food on the user's exclusion list, you have
probably misidentified it. Lower that item's confidence, name the most likely
alternative in `warnings`, and set `reason` to "exclusion_conflict" if you ask.

Always give tappable `options` and name the affected items in `affects_items`.
"""


def build_prompt(profile: dict, known_meals: list[str] | None = None) -> str:
    """Fill the vision prompt template from the caller's profile.

    Every {} slot is per-user: nothing about any one user is hardcoded
    (project-plan.md 4.1). Restaurants and known meals come from meal history
    that does not exist until Phase 3; with them empty the prompt degrades
    safely by asking the hidden-fat question more often.
    """

    def as_list(values: list[str]) -> str:
        return ", ".join(values) if values else "(none given)"

    return PROMPT_TEMPLATE.format(
        cuisines=as_list(profile.get("cuisines") or []),
        exclusions=as_list(profile.get("exclusions") or []),
        restaurants="(none yet)",
        known_meals=as_list(known_meals or []),
    )


def _build_contents(prompt: str, images: list[tuple[bytes, str]]) -> list:
    # Images stay in memory as inline parts -- no temp files, no Files API.
    parts = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in images]
    return [*parts, prompt]


def analyze_meal(
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    *,
    client: genai.Client | None = None,
) -> VisionAnalysis:
    """One stateless Gemini call, with a single retry on malformed output.

    `response_schema` makes Gemini enforce our schema server-side, so invalid
    output is rare -- but truncation and refusals still happen, so the retry
    required by CLAUDE.md stays as the backstop.
    """
    client = client or genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    images = images or []
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=VisionAnalysis,
    )

    attempt_prompt = prompt
    last_error = ""

    for attempt in range(2):
        response = _generate(client, _build_contents(attempt_prompt, images), config)

        if isinstance(response.parsed, VisionAnalysis):
            return response.parsed

        # Schema enforcement failed; try to validate the raw text ourselves so
        # the retry can quote a specific error back to the model.
        try:
            return VisionAnalysis.model_validate_json(response.text or "")
        except ValidationError as exc:
            last_error = str(exc)

        if attempt == 0:
            attempt_prompt = (
                f"{prompt}\n\nYour previous response failed validation with this "
                f"error:\n{last_error}\n\nReturn corrected JSON matching the schema exactly."
            )

    raise VisionError(f"Gemini output failed validation twice: {last_error}")


FAT_PHOTO_PROMPT = """\
This photo shows the cooking fat a user added to a meal -- a bottle, jar, tub,
spoon, or the pan it went into.

Identify the specific fat as `fat_name` (e.g. "ghee", "olive oil", "butter",
"coconut oil"). Use a plain generic name suitable for a USDA food search, not a
brand name.

If the photo contains no cooking fat at all -- it shows something else
entirely, or nothing recognisable -- return null for `fat_name`. Return null,
never a sentence explaining that you found nothing: the field is a food name
and the app displays it as one.

Estimate `grams` ONLY if the photo actually shows an AMOUNT -- oil in a
measuring spoon, a visible pour, a coating in a pan. If it only shows a
container, so you can tell what the fat is but not how much was used, return
null for grams. Do not guess an amount you cannot see; the app will ask the user
separately.

Reference amounts: 1 tsp of oil is about 4.5g, 1 tbsp about 13.6g.
"""


def identify_fat_from_photo(
    image: bytes, mime_type: str, *, client: genai.Client | None = None
) -> FatAnswer:
    """Read the fat type (and amount, if visible) off a photo.

    The model supplies identification and portion only -- exactly its job under
    invariant #1. Python still computes every calorie, from USDA. This is the
    follow-up call project-plan.md 3.3.6 sanctions: one that changes what the
    food IS, not one that does arithmetic.
    """
    client = client or genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    response = _generate(
        client,
        [types.Part.from_bytes(data=image, mime_type=mime_type), FAT_PHOTO_PROMPT],
        types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=FatAnswer,
        ),
    )

    if isinstance(response.parsed, FatAnswer):
        return response.parsed
    try:
        return FatAnswer.model_validate_json(response.text or "")
    except ValidationError as exc:
        raise VisionError(f"Could not read the fat photo: {exc}") from exc
