-- Phase 3: a user's own food library.
--
-- Exists because USDA has real gaps. It has no "poha", so it matches a
-- groundcherry entry sharing the word, and no smarter matcher fixes a food
-- that isn't in the database. Saving it once makes it right permanently.

create table public.saved_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  -- Set when the food came from scanning a package.
  barcode text,
  kcal_per_100g numeric not null check (kcal_per_100g >= 0),
  protein_per_100g numeric not null default 0 check (protein_per_100g >= 0),
  carbs_per_100g numeric not null default 0 check (carbs_per_100g >= 0),
  fat_per_100g numeric not null default 0 check (fat_per_100g >= 0),
  -- What this user calls one serving. A plate of poha is 250g, not 100g.
  serving_grams numeric not null default 100 check (serving_grams > 0),
  source text not null default 'manual' check (source in ('manual', 'usda', 'barcode')),
  usda_fdc_id int,
  created_at timestamptz not null default now(),
  -- One entry per food name per user; saving again updates rather than
  -- creating a second copy that would make matching ambiguous.
  unique (user_id, name)
);

create index saved_foods_user_idx on public.saved_foods (user_id);
-- Barcode lookups go straight to this, so it needs its own index.
create index saved_foods_barcode_idx on public.saved_foods (user_id, barcode)
  where barcode is not null;

alter table public.saved_foods enable row level security;

create policy "Users can select own saved foods"
  on public.saved_foods for select using (auth.uid() = user_id);
create policy "Users can insert own saved foods"
  on public.saved_foods for insert with check (auth.uid() = user_id);
create policy "Users can update own saved foods"
  on public.saved_foods for update using (auth.uid() = user_id);
create policy "Users can delete own saved foods"
  on public.saved_foods for delete using (auth.uid() = user_id);
