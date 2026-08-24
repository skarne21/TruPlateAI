"""Read a nutrition label from a photo.

Open Food Facts covers a lot of packaging but misses plenty -- regional
brands, supermarket own-labels, anything recent. Rather than give up, the user
photographs the panel on the back and the model reads the numbers off it.

This does not breach the rule that the model never supplies nutrition numbers.
It is doing what it does everywhere else in this project: identification from
an image. The numbers exist on a real label; the model transcribes them, and
the user checks them before they are saved.
"""

import os

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
import models
from pydantic import BaseModel, ValidationError

from vision import VisionError, friendly_genai_error



class NutritionLabel(BaseModel):
    product_name: str | None
    # Labels state their figures per 100g or per serving, and the two are not
    # interchangeable -- storing a per-serving figure as per-100g misstates the
    # food by however far the serving differs.
    basis: str  # per_100g | per_serving
    serving_grams: float | None
    kcal: float | None
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None


LABEL_PROMPT = """\
This is a photo of the nutrition information panel on a food package. Read the
numbers off it.

RULES
- Transcribe only what is printed. If a figure is not on the label, return null
  for it. Do NOT fill in what a product like this usually contains -- an
  invented number here becomes calories the user never ate.
- Say which basis the panel uses in `basis`: "per_100g" if the column you read
  is per 100g or per 100ml, "per_serving" if it is per serving, portion, pack
  or piece.
- If the panel shows both, read the per 100g column and set basis to
  "per_100g".
- If you use the per-serving column, put the serving weight in grams in
  `serving_grams`. If the serving weight is not printed, return null for it.
- `kcal` is energy in kilocalories. Panels often print kilojoules first --
  do not confuse the two. If only kJ is shown, divide by 4.184.
- `product_name` is the product as printed on the package, or null if this
  photo shows only the panel.
- If this is not a nutrition label at all, return null for every field.
"""


def per_100g(label: NutritionLabel) -> dict[str, float] | None:
    """Convert whatever the panel said into per-100g figures.

    Returns None when the label can't be used: no calories, or per-serving
    figures with no serving weight to scale them by. Guessing either would put
    a permanently wrong number in the user's library.
    """
    if label.kcal is None:
        return None

    scale = 1.0
    if label.basis == "per_serving":
        if not label.serving_grams or label.serving_grams <= 0:
            return None
        scale = 100.0 / label.serving_grams

    def value(number: float | None) -> float:
        return (number or 0.0) * scale

    return {
        "kcal_per_100g": label.kcal * scale,
        "protein_per_100g": value(label.protein_g),
        "carbs_per_100g": value(label.carbs_g),
        "fat_per_100g": value(label.fat_g),
    }


def read_label(
    image: bytes, mime_type: str, *, client: genai.Client | None = None
) -> NutritionLabel:
    """Transcribe a nutrition panel from a photo."""
    client = client or genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    try:
        response = client.models.generate_content(
            model=models.LABEL,
            contents=[types.Part.from_bytes(data=image, mime_type=mime_type), LABEL_PROMPT],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=NutritionLabel,
            ),
        )
    except genai_errors.APIError as exc:
        raise VisionError(friendly_genai_error(exc)) from exc

    if isinstance(response.parsed, NutritionLabel):
        return response.parsed
    try:
        return NutritionLabel.model_validate_json(response.text or "")
    except ValidationError as exc:
        raise VisionError("Couldn't read that label. Try a clearer photo.") from exc
