-- Phase 3: the recipe corpus Foodie searches.

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cuisine text not null,
  cost_level text not null check (cost_level in ('low', 'medium', 'high')),
  minutes int not null,
  -- name, grams and usda_query per ingredient, kept so a recipe can be
  -- re-priced later without asking the model to write it again.
  ingredients jsonb not null,
  steps text[] not null,
  -- Allergen groups, derived in code from the ingredient names rather than
  -- taken from the model (CLAUDE.md invariant #5).
  contains text[] not null default '{}',
  -- Summed from USDA per-ingredient. A recipe whose ingredients could not all
  -- be priced is never inserted, so these are never partly guessed.
  kcal numeric not null,
  protein_g numeric not null,
  carbs_g numeric not null,
  fat_g numeric not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);

create index recipes_vector_idx on public.recipes using hnsw (embedding vector_cosine_ops);
create index recipes_contains_idx on public.recipes using gin (contains);

-- The one table in this project without a user_id, deliberately. This is a
-- shared reference corpus -- a cookbook, not somebody's data. RLS stays ON so
-- nothing is readable by accident, with a policy granting read to any signed-in
-- user and no write policy at all: only the service role that runs the build
-- script can insert.
alter table public.recipes enable row level security;

create policy "Signed-in users can read recipes"
  on public.recipes for select
  to authenticated
  using (true);

-- Semantic search and the safety filters in one query, so a recipe containing
-- an excluded ingredient never reaches the application, let alone the model.
create or replace function public.match_recipes(
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
  similarity float
)
language sql
stable
as $$
  select
    r.id, r.title, r.cuisine, r.cost_level, r.minutes,
    r.ingredients, r.steps, r.contains,
    r.kcal, r.protein_g, r.carbs_g, r.fat_g,
    1 - (r.embedding <=> query_embedding) as similarity
  from public.recipes r
  where
    -- The hard filter. && is "arrays overlap", so this drops any recipe
    -- sharing even one allergen group with the user's exclusions.
    not (r.contains && coalesce(exclusions, '{}'))
    and (max_kcal is null or r.kcal <= max_kcal)
    and (min_protein is null or r.protein_g >= min_protein)
  order by r.embedding <=> query_embedding
  limit match_count;
$$;
