"""Build the recipe corpus. Run once (or to top it up); not part of the app.

The model writes the recipe; USDA prices it; code decides what allergens it
contains. A recipe whose ingredients can't all be priced is dropped rather than
published with partly-guessed numbers.

    cd api && .venv/Scripts/python.exe scripts/build_recipes.py --per-cuisine 6
"""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel
from supabase import create_client

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import models  # noqa: E402
from foods import normalize_name  # noqa: E402
from memory import embed_meal  # noqa: E402
from recipes import Ingredient, allergens_for, price_recipe, recipe_search_text  # noqa: E402

# Cuisines to cover. The first is the one the app's first user actually eats;
# the rest keep the corpus from being useless to anyone else.
CUISINES = [
    "South Indian", "North Indian", "Mediterranean", "Mexican",
    "Chinese", "Japanese", "Middle Eastern", "Italian",
]

ALLERGEN_GROUPS = (
    "dairy, eggs, gluten, nuts, peanuts, seafood, shellfish, soy, sesame, pork, beef"
)


class GeneratedIngredient(BaseModel):
    name: str
    usda_query: str
    grams: float


class GeneratedRecipe(BaseModel):
    title: str
    cuisine: str
    cost_level: str
    minutes: int
    servings: int
    ingredients: list[GeneratedIngredient]
    steps: list[str]
    contains: list[str]


class Batch(BaseModel):
    recipes: list[GeneratedRecipe]


def generate(
    client: genai.Client, cuisine: str, count: int, avoid: list[str]
) -> list[GeneratedRecipe]:
    prompt = (
        f"Write {count} varied {cuisine} recipes a student could cook at home. "
        "Favour high-protein, affordable dishes. For every ingredient give a "
        "weight in grams and a `usda_query`: a plain generic search phrase for "
        "the USDA food database (\"red lentils uncooked\", not \"a handful of "
        "dal\"). cost_level must be low, medium or high. Give `servings`: "
        "how many people the ingredient amounts feed, which is often more "
        "than one for a pasta or a curry. In `contains`, list "
        f"any of these the recipe includes: {ALLERGEN_GROUPS}."
    )
    # Naming what is already stored is cheaper than generating duplicates
    # and throwing them away: generation is the metered part, not the
    # insert. The check below still runs, because asking is not enforcing.
    if avoid:
        prompt += (
            " These are already in the collection, so write different "
            "dishes rather than variations of them: " + ", ".join(avoid) + "."
        )
    response = client.models.generate_content(
        model=models.RECIPES,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=Batch
        ),
    )
    return response.parsed.recipes if response.parsed else []


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-cuisine", type=int, default=5)
    args = parser.parse_args()

    gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    # The service role, because recipes are shared reference data with no write
    # policy -- this script is the only thing allowed to insert them.
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    # Safe to re-run: this tops the corpus up rather than rebuilding it,
    # because a run can die partway through when the daily AI quota
    # runs out -- which is exactly what happened on the first run.
    existing = db.table("recipes").select("title, cuisine").execute().data or []
    seen = {normalize_name(r["title"]) for r in existing}
    print(f"{len(existing)} recipes already stored.")

    kept = dropped = skipped = 0
    for cuisine in CUISINES:
        print(f"\n{cuisine}")
        avoid = [r["title"] for r in existing if r["cuisine"] == cuisine]
        try:
            generated = generate(gemini, cuisine, args.per_cuisine, avoid)
        except Exception as exc:
            print(f"  generation failed: {str(exc)[:90]}")
            continue

        for recipe in generated:
            title_key = normalize_name(recipe.title)
            if title_key in seen:
                print(f"  skipped  {recipe.title[:44]} (already stored)")
                skipped += 1
                continue

            ingredients = [
                Ingredient(name=i.name, grams=i.grams, usda_query=i.usda_query)
                for i in recipe.ingredients
            ]

            macros = price_recipe(ingredients)
            if macros is None:
                print(f"  dropped  {recipe.title[:44]} (an ingredient wouldn't price)")
                dropped += 1
                continue

            # price_recipe sums the whole ingredient list. Stored per
            # serving, so a recipe's numbers mean the same thing as a
            # logged meal's and can be compared with a daily target.
            servings = max(1, min(12, recipe.servings))
            macros = {k: v / servings for k, v in macros.items()}

            embedding = embed_meal(recipe_search_text(recipe.title, cuisine, ingredients))
            if embedding is None:
                print(f"  dropped  {recipe.title[:44]} (no embedding)")
                dropped += 1
                continue

            contains = allergens_for(ingredients, recipe.contains)
            db.table("recipes").insert({
                "title": recipe.title,
                "cuisine": cuisine,
                "cost_level": recipe.cost_level.lower(),
                "minutes": recipe.minutes,
                "servings": servings,
                "ingredients": [i.model_dump() for i in ingredients],
                "steps": recipe.steps,
                "contains": contains,
                "embedding": embedding,
                **{k: round(v, 1) for k, v in macros.items()},
            }).execute()

            seen.add(title_key)
            kept += 1
            print(f"  kept     {recipe.title[:44]:<44} {macros['kcal']:>5.0f} kcal "
                  f"{macros['protein_g']:>4.0f}g protein  /serving (x{servings})  "
                  f"contains={contains or '-'}")

    print(f"\n{kept} stored, {dropped} dropped, {skipped} already present.")


if __name__ == "__main__":
    main()
