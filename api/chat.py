"""Coach assistant: context building, tools, and the streaming call.

The numbers the Coach quotes are computed in SQL and handed to it. It never
counts anything itself -- same discipline that keeps the dashboard honest.
"""

import os
from dataclasses import dataclass
from datetime import date, timedelta

from google import genai
from google.genai import types
from pydantic import BaseModel

import usda
from targets import TargetsInput, calculate_targets

MODEL = "gemini-2.5-flash"

# Turns of conversation resent per request. Durable facts arrive from SQL, so
# the Coach's memory of your history does not depend on what fits in here.
HISTORY_LIMIT = 20

# Measured: 7.70s to first token with thinking on, 0.82s with it off. Chat is
# judged on responsiveness and the reasoning here is light -- the numbers are
# pre-computed. The vision pipeline keeps thinking on, where accuracy matters
# more than latency. Raise this if answers prove shallow.
THINKING_BUDGET = 0

SYSTEM_PROMPT = """\
You are the Coach in TruPlate AI, a nutrition tracking app. You help the user
hit their calorie and protein targets using food they actually eat.

HOW TO ANSWER
- Be concise and concrete. Prefer specific foods and amounts over general advice.
- The user's profile and recent numbers are given below. They are computed from
  their real logs -- trust them completely and quote them directly.
- Never do arithmetic on logged data yourself. If you need numbers beyond the
  summary below, call get_logs. If you need macros for a food they have not
  logged, call usda_lookup.
- Respect their cuisines and exclusions in every suggestion. An exclusion is
  absolute -- never suggest a food containing one, even as an aside.
- If they have logged nothing yet, say so plainly and suggest logging a meal
  rather than inventing progress.

BOUNDARIES
- You give nutrition guidance, not medical advice. If asked about medication,
  a diagnosed condition, symptoms, or anything clinical, say briefly that it is
  worth asking a doctor or dietitian, and offer what general nutrition help you
  can alongside.
- Do not endorse very low calorie intakes or rapid weight loss. Their targets
  are already capped at safe rates by the app.

{summary}
"""


@dataclass
class DayRow:
    """One day's logged totals."""

    day: date
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    meals: int


class ChatIn(BaseModel):
    message: str


def summarise_history(history: list[dict], limit: int = HISTORY_LIMIT) -> list[dict]:
    """Keep the most recent turns. Older context comes from SQL instead."""
    return history[-limit:] if len(history) > limit else history


def build_summary(profile: dict, today: date, days: list[DayRow]) -> str:
    """Render the user's real numbers as text for the system prompt.

    Everything here is SQL-derived. The model reads it; it never computes it.
    """
    targets = calculate_targets(TargetsInput(**profile))
    kcal_target = round(targets.kcal_target)
    protein_target = round(targets.protein_g)

    today_row = next((d for d in days if d.day == today), None)
    if today_row is None:
        today_text = (
            f"Today: no meals logged yet. Target is {kcal_target} kcal "
            f"and {protein_target}g protein."
        )
    else:
        today_text = (
            f"Today: {round(today_row.kcal)} kcal and {round(today_row.protein_g)}g protein "
            f"across {today_row.meals} meal(s). "
            f"Target is {kcal_target} kcal and {protein_target}g protein, so "
            f"{round(kcal_target - today_row.kcal)} kcal and "
            f"{round(protein_target - today_row.protein_g)}g protein remain."
        )

    if days:
        # Average over days actually logged, not over 7 calendar days --
        # dividing by 7 when only 2 were logged understates intake badly and
        # would have the Coach advising a deficit that isn't real.
        avg_kcal = round(sum(d.kcal for d in days) / len(days))
        avg_protein = round(sum(d.protein_g for d in days) / len(days))
        recent_text = (
            f"Last 7 days: logged on {len(days)} of the last 7 days, averaging "
            f"{avg_kcal} kcal and {avg_protein}g protein on the days logged."
        )
    else:
        recent_text = "Last 7 days: nothing logged."

    cuisines = ", ".join(profile.get("cuisines") or []) or "not specified"
    exclusions = ", ".join(profile.get("exclusions") or []) or "none"

    return (
        "THEIR DATA (computed from their logs -- quote these numbers directly)\n"
        f"- Goal: {profile['goal']} at {profile['rate_lb_per_week']} lb/week\n"
        f"- Cuisines they eat: {cuisines}\n"
        f"- Exclusions (absolute): {exclusions}\n"
        f"- {today_text}\n"
        f"- {recent_text}"
    )


def fetch_days(client, user_id: str, today: date, days_back: int = 7) -> list[DayRow]:
    """Per-day totals over a window, newest first. Plain SQL, never an LLM."""
    start = today - timedelta(days=days_back - 1)
    rows = (
        client.table("meals")
        .select("logged_on, kcal, protein_g, carbs_g, fat_g")
        .eq("user_id", user_id)
        .eq("status", "confirmed")
        .gte("logged_on", start.isoformat())
        .lte("logged_on", today.isoformat())
        .execute()
    ).data

    by_day: dict[date, DayRow] = {}
    for row in rows:
        day = date.fromisoformat(row["logged_on"])
        current = by_day.get(day) or DayRow(day, 0.0, 0.0, 0.0, 0.0, 0)
        by_day[day] = DayRow(
            day=day,
            kcal=current.kcal + (row.get("kcal") or 0.0),
            protein_g=current.protein_g + (row.get("protein_g") or 0.0),
            carbs_g=current.carbs_g + (row.get("carbs_g") or 0.0),
            fat_g=current.fat_g + (row.get("fat_g") or 0.0),
            meals=current.meals + 1,
        )
    return sorted(by_day.values(), key=lambda d: d.day, reverse=True)


def build_tools(client, user_id: str, today: date) -> list:
    """Tools bound to one user.

    Each closes over the caller's RLS-scoped client and their id. There is no
    parameter for whose data to read, so a tool cannot be pointed at another
    user's rows even if the model tried.
    """

    def get_logs(days: int) -> dict:
        """Get the user's logged food totals for each of the last N days.

        Args:
            days: How many days back to look, from 1 to 90.
        """
        window = max(1, min(int(days), 90))
        rows = fetch_days(client, user_id, today, window)
        return {
            "days_requested": window,
            "days_logged": len(rows),
            "per_day": [
                {
                    "date": r.day.isoformat(),
                    "kcal": round(r.kcal),
                    "protein_g": round(r.protein_g),
                    "carbs_g": round(r.carbs_g),
                    "fat_g": round(r.fat_g),
                    "meals": r.meals,
                }
                for r in rows
            ],
        }

    def usda_lookup(food: str) -> dict:
        """Look up per-100g nutrition for a food from the USDA database.

        Args:
            food: Plain English food name, e.g. "paneer" or "rolled oats".
        """
        match = usda.pick_best_match(usda.search_food(food))
        if match is None:
            return {"found": False, "food": food}
        macros = usda.macros_for_grams(match, 100)
        return {
            "found": True,
            "description": match.get("description"),
            "per_100g": {k: (round(v, 1) if v is not None else None) for k, v in macros.items()},
        }

    return [get_logs, usda_lookup]


def stream_reply(system_prompt: str, history: list[dict], tools: list, *, client=None):
    """Stream the Coach's reply, yielding text as it arrives.

    Automatic function calling means the SDK runs the whole tool loop itself;
    streaming still works across a tool call (measured).
    """
    client = client or genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    contents = [
        types.Content(role=("user" if m["role"] == "user" else "model"),
                      parts=[types.Part(text=m["content"])])
        for m in history
    ]
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=tools,
        thinking_config=types.ThinkingConfig(thinking_budget=THINKING_BUDGET),
    )
    for chunk in client.models.generate_content_stream(
        model=MODEL, contents=contents, config=config
    ):
        if chunk.text:
            yield chunk.text
