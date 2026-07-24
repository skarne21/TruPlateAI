-- Phase 1: logged meals and their items, plus private photo storage.

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_at timestamptz not null default now(),
  -- The user's LOCAL calendar date, sent by the client. "Today's totals" is a
  -- local-calendar question and the server has no reliable idea what day it is
  -- where the user is, so the client decides and we never do timezone math.
  logged_on date not null,
  input_mode text not null check (input_mode in ('photo', 'text', 'photo_text')),
  photo_paths text[] not null default '{}',
  caption text,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'draft', 'failed')),
  kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  -- Raw Gemini response, kept for debugging and the Phase 4 eval set.
  analysis_json jsonb
);

create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  -- Denormalized on purpose: it lets the RLS policy be a plain column
  -- comparison instead of an EXISTS subquery against meals on every row.
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  usda_query text,
  grams numeric not null,
  count numeric,
  unit text,
  source text not null check (source in ('usda', 'llm', 'user')),
  usda_fdc_id int,
  usda_description text,
  kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  confidence numeric
);

create index meals_user_day_idx on public.meals (user_id, logged_on);
create index meal_items_meal_idx on public.meal_items (meal_id);

alter table public.meals enable row level security;
alter table public.meal_items enable row level security;

create policy "Users can select own meals"
  on public.meals for select using (auth.uid() = user_id);
create policy "Users can insert own meals"
  on public.meals for insert with check (auth.uid() = user_id);
create policy "Users can update own meals"
  on public.meals for update using (auth.uid() = user_id);
create policy "Users can delete own meals"
  on public.meals for delete using (auth.uid() = user_id);

create policy "Users can select own meal items"
  on public.meal_items for select using (auth.uid() = user_id);
create policy "Users can insert own meal items"
  on public.meal_items for insert with check (auth.uid() = user_id);
create policy "Users can update own meal items"
  on public.meal_items for update using (auth.uid() = user_id);
create policy "Users can delete own meal items"
  on public.meal_items for delete using (auth.uid() = user_id);

-- Private bucket: photos are only reachable through a signed URL or the
-- owner's own session, never by guessing the path.
insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do nothing;

-- Objects live at meal-photos/{user_id}/{uuid}.jpg, so the first path segment
-- is the owner and can be compared straight against auth.uid().
create policy "Users can upload own meal photos"
  on storage.objects for insert
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own meal photos"
  on storage.objects for select
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own meal photos"
  on storage.objects for delete
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
