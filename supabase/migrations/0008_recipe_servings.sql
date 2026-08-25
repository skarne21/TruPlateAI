-- Recipe macros were summed over the whole ingredient list, and nothing
-- recorded how many people that list feeds.
--
-- For a bowl of miso soup the whole list IS one serving. For a pot of
-- bolognese -- 200g dry pasta, 200g dry lentils, a kilo of food -- it is
-- three or four. Both were stored as a single number, so the Foodie could
-- offer "Classic Lentil Bolognese, 1656 kcal" as a meal and be wrong by 4x.
--
-- That is precisely the failure this project is built to avoid: not a number
-- that is obviously broken, but one that is plausible and false.
--
-- From here the macro columns are PER SERVING, and `servings` records how many
-- the ingredient list makes -- so the recipe stays cookable exactly as written
-- while the numbers stay comparable to a logged meal.

alter table public.recipes
  add column servings smallint not null default 1
    check (servings between 1 and 12);

comment on column public.recipes.servings is
  'How many servings the ingredient list makes. kcal, protein_g, carbs_g and '
  'fat_g are PER SERVING; the ingredients jsonb is for the whole recipe.';

-- Existing rows predate the distinction and their basis cannot be recovered --
-- there is no way to tell a one-serving soup from a four-serving pot after the
-- fact. They are cleared rather than left to be quietly wrong, and
-- scripts/build_recipes.py rebuilds the corpus from scratch.
delete from public.recipes;

-- match_recipes has to return the new column too, or the Foodie can quote a
-- correct per-serving calorie number while the reader cooks the whole pot and
-- eats it. Postgres will not let `create or replace` change a function's
-- return type, so it is dropped and recreated.
drop function if exists public.match_recipes(vector, text[], numeric, numeric, int);

create function public.match_recipes(
  query_embedding vector(768),
  exclusions text[] default '{}',
  max_kcal numeric default null,
  min_protein numeric default null,
  match_count int default 5
)
returns table (
  id uuid, title text, cuisine text, cost_level text, minutes int,
  ingredients jsonb, steps text[], contains text[],
  kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  servings smallint, similarity float
)
language sql
stable
as $$
  select
    r.id, r.title, r.cuisine, r.cost_level, r.minutes,
    r.ingredients, r.steps, r.contains,
    r.kcal, r.protein_g, r.carbs_g, r.fat_g,
    r.servings,
    1 - (r.embedding <=> query_embedding) as similarity
  from public.recipes r
  where
    -- The hard filter. && is "arrays overlap", so this drops any recipe
    -- sharing even one allergen group with the user's exclusions.
    not (r.contains && coalesce(exclusions, '{}'))
    -- Both limits now compare against per-serving numbers, which is what the
    -- caller means by "under 600 calories".
    and (max_kcal is null or r.kcal <= max_kcal)
    and (min_protein is null or r.protein_g >= min_protein)
  order by r.embedding <=> query_embedding
  limit match_count;
$$;
