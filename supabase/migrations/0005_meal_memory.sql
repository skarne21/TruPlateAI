-- Phase 3: meal memory. Recognise a meal the user has logged before.

-- pgvector adds a `vector` column type and distance operators to Postgres, so
-- similarity search happens in the database we already have rather than in a
-- separate vector service that would need its own access control.
create extension if not exists vector;

create table public.meal_embeddings (
  -- One embedding per meal, and deleting a meal takes its memory with it.
  meal_id uuid primary key references public.meals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  -- 768 rather than the model's default 3072: pgvector's indexes stop at 2000
  -- dimensions, and 768 measured just as capable of separating meals.
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);

alter table public.meal_embeddings enable row level security;

create policy "Users can select own meal embeddings"
  on public.meal_embeddings for select using (auth.uid() = user_id);
create policy "Users can insert own meal embeddings"
  on public.meal_embeddings for insert with check (auth.uid() = user_id);
create policy "Users can update own meal embeddings"
  on public.meal_embeddings for update using (auth.uid() = user_id);
create policy "Users can delete own meal embeddings"
  on public.meal_embeddings for delete using (auth.uid() = user_id);

-- HNSW index for cosine distance. Without it every search reads every row,
-- which is fine for ten meals and not for ten thousand.
create index meal_embeddings_vector_idx
  on public.meal_embeddings
  using hnsw (embedding vector_cosine_ops);

create index meal_embeddings_user_idx on public.meal_embeddings (user_id);

-- Similarity search has to run inside the database (the `<=>` operator isn't
-- reachable through the REST API), so it lives in a function.
--
-- `<=>` is cosine DISTANCE, where 0 means identical. Similarity is 1 - distance,
-- which is the number the application reasons about.
create or replace function public.match_meals(
  query_embedding vector(768),
  match_user_id uuid,
  match_count int default 3
)
returns table (
  meal_id uuid,
  summary text,
  similarity float,
  logged_on date,
  kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric
)
language sql
stable
-- Deliberately NOT `security definer`: this runs as the calling user, so the
-- row-level policies above still apply and the extra user_id filter below is a
-- second lock rather than the only one.
as $$
  select
    e.meal_id,
    e.summary,
    1 - (e.embedding <=> query_embedding) as similarity,
    m.logged_on,
    m.kcal,
    m.protein_g,
    m.carbs_g,
    m.fat_g
  from public.meal_embeddings e
  join public.meals m on m.id = e.meal_id
  where e.user_id = match_user_id
    and m.status = 'confirmed'
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
