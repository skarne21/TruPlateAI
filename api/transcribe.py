"""Voice input: audio -> a cleaned meal description.

This is a transcribe-and-clean pass, not plain speech-to-text. The polish that
makes dictation feel good is an LLM cleanup step, not better ears: dropping
filler, resolving self-corrections, cutting false starts.

The result fills an editable caption. It is never submitted automatically
(CLAUDE.md invariant #6) -- the user reads it and presses send, so a
misheard food is caught by a human before it becomes calories.
"""

import os
from collections import Counter

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
import models
from pydantic import BaseModel, ValidationError

from vision import VisionError, friendly_genai_error


# How many past foods to feed the model as vocabulary, and how far back to look.
VOCAB_SIZE = 25
HISTORY_ROWS = 200


class Transcript(BaseModel):
    text: str


TRANSCRIBE_PROMPT = """\
Transcribe this audio of someone describing a meal they ate, then clean it up.

CLEANING RULES
- Drop filler words: um, uh, like, you know.
- If the speaker corrects themselves, keep only the correction. "two idlis, no
  wait, three" becomes "three idlis".
- Cut false starts and repeated words.
- Keep every food word exactly as spoken. Do not translate, pluralise
  differently, or swap in a more common food.
- NEVER add a food that was not said. If you cannot make out an item, leave it
  out rather than guessing -- an invented food becomes calories the user never
  ate.
- Keep quantities exactly as stated. Do not estimate one that was not given.
- Return plain text, as if the user had typed it. No commentary, no quotes.
- If the audio contains no speech, or no food is described, return an empty
  string.
"""


def frequent_foods(client, user_id: str, limit: int = VOCAB_SIZE) -> list[str]:
    """The foods this user logs most, to prime the transcription.

    Generic speech-to-text mangles "idli" into "it'll" and "sambar" into
    "somber". Feeding the model the user's own vocabulary is what makes
    transcription work for the food they actually eat.
    """
    rows = (
        client.table("meal_items")
        .select("name")
        .eq("user_id", user_id)
        .limit(HISTORY_ROWS)
        .execute()
    ).data
    counts = Counter(row["name"] for row in rows if row.get("name"))
    return [name for name, _ in counts.most_common(limit)]


def build_transcribe_prompt(vocabulary: list[str]) -> str:
    if not vocabulary:
        return TRANSCRIBE_PROMPT
    return (
        f"{TRANSCRIBE_PROMPT}\n"
        "FOODS THIS USER EATS OFTEN -- prefer these spellings when a word is\n"
        "ambiguous, but never insert one that was not said:\n"
        f"{', '.join(vocabulary)}\n"
    )


def transcribe_audio(
    audio: bytes,
    mime_type: str,
    vocabulary: list[str],
    *,
    client: genai.Client | None = None,
) -> str:
    """Turn recorded audio into a cleaned meal description."""
    client = client or genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    prompt = build_transcribe_prompt(vocabulary)

    try:
        response = client.models.generate_content(
            model=models.TRANSCRIBE,
            contents=[types.Part.from_bytes(data=audio, mime_type=mime_type), prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=Transcript,
            ),
        )
    except genai_errors.APIError as exc:
        raise VisionError(friendly_genai_error(exc)) from exc

    if isinstance(response.parsed, Transcript):
        return response.parsed.text.strip()
    try:
        return Transcript.model_validate_json(response.text or "").text.strip()
    except ValidationError as exc:
        raise VisionError("Couldn't make out that recording. Try again.") from exc
