"""Turn a Gemini analysis into USDA-priced items, and adjust them from answers.

This is the bridge between vision.py (what the food is) and usda.py (what it
costs). All arithmetic here is deterministic Python -- CLAUDE.md invariant #10.
"""

from typing import Callable

from pydantic import BaseModel

import usda
from vision import VisionAnalysis

# Canonical clarifying-answer options. The LLM decides WHETHER to ask and which
# items are affected; these decide what an answer is worth. The frontend returns
# an index into these lists, so no natural language is ever parsed.
FAT_OPTIONS: list[tuple[str, float]] = [
    ("none", 0.0),
    ("1 tsp total", 4.5),
    ("1 tbsp total", 13.6),
    ("2+ tbsp total", 27.2),
]

PORTION_OPTIONS: list[tuple[str, float]] = [
    ("about half", 0.5),
    ("as estimated", 1.0),
    ("about 1.5x", 1.5),
    ("about double", 2.0),
]

# Only these two reasons produce answerable questions. low_confidence and
# exclusion_conflict change identification rather than arithmetic, which would
# need a second LLM call; Phase 1 surfaces those as warnings and lets the user
# fix them directly on the confirm screen.
ANSWERABLE_REASONS = {"hidden_fat", "portion"}

MAX_QUESTIONS = 3

# Display-only estimate for a question's headline impact, before we know which
# fat was actually used. Vegetable oil is ~884 kcal/100g per USDA. The number
# that actually gets logged is looked up from USDA in apply_fat_answer().
_OIL_KCAL_PER_G = 8.84

DEFAULT_FAT = "vegetable oil"

Search = Callable[..., list[dict]]


class ResolvedItem(BaseModel):
    """A food with real numbers attached, ready to show or log."""

    name: str
    usda_query: str
    grams: float
    count: float
    unit: str
    confidence: float
    source: str  # usda | llm | user
    usda_fdc_id: int | None = None
    usda_description: str | None = None
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None


def _priced_from_usda(query: str, grams: float, search: Search) -> tuple[dict, dict] | None:
    """Look a food up and scale it, or None if USDA can't price it."""
    match = usda.pick_best_match(search(query))
    if match is None:
        return None
    macros = usda.macros_for_grams(match, grams)
    if macros["kcal"] is None:
        return None  # a match with no energy value is no better than no match
    return match, macros


def resolve_items(
    analysis: VisionAnalysis, *, search: Search = usda.search_food
) -> list[ResolvedItem]:
    """Price every identified item, preferring USDA and falling back to the LLM."""
    resolved = []

    for item in analysis.items:
        priced = _priced_from_usda(item.usda_query, item.portion.grams, search)

        if priced is not None:
            match, macros = priced
            resolved.append(ResolvedItem(
                name=item.name,
                usda_query=item.usda_query,
                grams=item.portion.grams,
                count=item.portion.count,
                unit=item.portion.unit,
                confidence=item.confidence,
                source="usda",
                usda_fdc_id=match.get("fdcId"),
                usda_description=match.get("description"),
                **macros,
            ))
        else:
            # Flagged as an estimate in the UI, per invariant #1.
            estimate = item.llm_estimate
            resolved.append(ResolvedItem(
                name=item.name,
                usda_query=item.usda_query,
                grams=item.portion.grams,
                count=item.portion.count,
                unit=item.portion.unit,
                confidence=item.confidence,
                source="llm",
                kcal=estimate.calories,
                protein_g=estimate.protein_g,
                carbs_g=estimate.carbs_g,
                fat_g=estimate.fat_g,
            ))

    return resolved


def totals_for(items: list[ResolvedItem]) -> dict[str, float]:
    """Sum a meal. A missing macro contributes nothing rather than crashing."""
    return {
        key: sum(getattr(item, key) or 0.0 for item in items)
        for key in ("kcal", "protein_g", "carbs_g", "fat_g")
    }


def canonical_questions(analysis: VisionAnalysis) -> list[dict]:
    """Replace the model's free-text options with our priced, indexable ones."""
    questions = []

    for question in analysis.clarifying_questions:
        if question.reason not in ANSWERABLE_REASONS:
            continue

        if question.reason == "hidden_fat":
            options = FAT_OPTIONS
            impact = f"up to +{FAT_OPTIONS[-1][1] * _OIL_KCAL_PER_G:.0f} kcal"
        else:
            options = PORTION_OPTIONS
            impact = "changes this item's portion"

        questions.append({
            "id": question.id,
            "question": question.question,
            "reason": question.reason,
            "affects_items": question.affects_items,
            "options": [{"index": i, "label": label} for i, (label, _) in enumerate(options)],
            "kcal_impact": impact,
        })

    return questions[:MAX_QUESTIONS]


def apply_fat_answer(
    items: list[ResolvedItem],
    option_index: int,
    fat_name: str = DEFAULT_FAT,
    grams: float | None = None,
    *,
    search: Search = usda.search_food,
) -> list[ResolvedItem]:
    """Add cooking fat as an ordinary meal item.

    Modelling fat as a normal item (rather than a special adjustment) means it
    gets real USDA numbers -- butter is ~717 kcal/100g against ghee's ~900, so
    a single hardcoded kcal/g would be wrong for one of them -- and the user can
    see, edit or delete it like anything else.

    `grams` overrides the option table when a photo of the oil gave us a real
    amount to work with.
    """
    if grams is None:
        grams = FAT_OPTIONS[option_index][1]
    if grams <= 0:
        return list(items)

    priced = _priced_from_usda(fat_name, grams, search)
    if priced is not None:
        match, macros = priced
        fat_item = ResolvedItem(
            name=fat_name, usda_query=fat_name, grams=grams, count=1, unit="serving",
            confidence=1.0, source="user", usda_fdc_id=match.get("fdcId"),
            usda_description=match.get("description"), **macros,
        )
    else:
        fat_item = ResolvedItem(
            name=fat_name, usda_query=fat_name, grams=grams, count=1, unit="serving",
            confidence=1.0, source="llm", kcal=grams * _OIL_KCAL_PER_G,
            protein_g=0.0, carbs_g=0.0, fat_g=grams,
        )

    return [*items, fat_item]


def apply_portion_answer(
    items: list[ResolvedItem], item_name: str, option_index: int
) -> list[ResolvedItem]:
    """Scale one item's portion, leaving every other item alone."""
    multiplier = PORTION_OPTIONS[option_index][1]
    updated = []

    for item in items:
        if item.name != item_name or multiplier == 1.0:
            updated.append(item)
            continue

        scaled = item.model_copy(update={
            "grams": item.grams * multiplier,
            **{
                key: (getattr(item, key) * multiplier if getattr(item, key) is not None else None)
                for key in ("kcal", "protein_g", "carbs_g", "fat_g")
            },
        })
        updated.append(scaled)

    return updated
