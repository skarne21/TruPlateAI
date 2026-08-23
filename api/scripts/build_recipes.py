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

from memory import embed_meal  # noqa: E402
from recipes import Ingredient, allergens_for, price_recipe, recipe_search_text  # noqa: E402

MODEL = "gemini-2.5-flash"

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
    ingredients: list[GeneratedIngredient]
    steps: list[str]
    contains: list[str]


class Batch(BaseModel):
    recipes: list[GeneratedRecipe]


def generate(client: genai.Client, cuisine: str, count: int) -> list[GeneratedRecipe]:
    prompt = (
        f"Write {count} varied {cuisine} recipes a student could cook at home. "
        "Favour high-protein, affordable dishes. For every ingredient give a "
        "weight in grams and a `usda_query`: a plain generic search phrase for "
        "the USDA food database (\"red lentils uncooked\", not \"a handful of "
        "dal\"). cost_level must be low, medium or high. In `contains`, list "
        f"any of these the recipe includes: {ALLERGEN_GROUPS}."
    )
    response = client.models.generate_content(
        model=MODEL,
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

    kept = dropped = 0
    for cuisine in CUISINES:
        print(f"\n{cuisine}")
        try:
            generated = generate(gemini, cuisine, args.per_cuisine)
        except Exception as exc:
            print(f"  generation failed: {str(exc)[:90]}")
            continue

        for recipe in generated:
            ingredients = [
                Ingredient(name=i.name, grams=i.grams, usda_query=i.usda_query)
                for i in recipe.ingredients
            ]

            macros = price_recipe(ingredients)
            if macros is None:
                print(f"  dropped  {recipe.title[:44]} (an ingredient wouldn't price)")
                dropped += 1
                continue

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
                "ingredients": [i.model_dump() for i in ingredients],
                "steps": recipe.steps,
                "contains": contains,
                "embedding": embedding,
                **{k: round(v, 1) for k, v in macros.items()},
            }).execute()

            kept += 1
            print(f"  kept     {recipe.title[:44]:<44} {macros['kcal']:>5.0f} kcal "
                  f"{macros['protein_g']:>4.0f}g protein  contains={contains or '-'}")

    print(f"\n{kept} recipes stored, {dropped} dropped.")


if __name__ == "__main__":
    main()
