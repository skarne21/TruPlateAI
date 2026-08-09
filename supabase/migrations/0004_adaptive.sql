-- Phase 3: weigh-in history and the target history the adaptive engine writes.

create table public.weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_kg numeric not null check (weight_kg > 0),
  -- The client's local date, as everywhere else: "today" is a local-calendar
  -- question and the server does no timezone maths.
  measured_on date not null,
  created_at timestamptz not null default now(),
  -- One weigh-in per day. Stepping on the scale twice replaces the reading
  -- rather than double-counting it in the average.
  unique (user_id, measured_on)
);

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_date date not null,
  kcal numeric not null,
  protein_g numeric not null,
  source text not null check (source in ('formula', 'adaptive')),
  -- Plain language, shown to the user. A target that moves without a reason
  -- reads as a bug, so the reason is stored with the change rather than
  -- recomputed later from numbers that have since moved on.
  explanation text not null,
  created_at timestamptz not null default now()
);

create index weights_user_date_idx on public.weights (user_id, measured_on);
create index targets_user_date_idx on public.targets (user_id, effective_date desc);

alter table public.weights enable row level security;
alter table public.targets enable row level security;

create policy "Users can select own weights"
  on public.weights for select using (auth.uid() = user_id);
create policy "Users can insert own weights"
  on public.weights for insert with check (auth.uid() = user_id);
create policy "Users can update own weights"
  on public.weights for update using (auth.uid() = user_id);
create policy "Users can delete own weights"
  on public.weights for delete using (auth.uid() = user_id);

create policy "Users can select own targets"
  on public.targets for select using (auth.uid() = user_id);
create policy "Users can insert own targets"
  on public.targets for insert with check (auth.uid() = user_id);
create policy "Users can update own targets"
  on public.targets for update using (auth.uid() = user_id);
create policy "Users can delete own targets"
  on public.targets for delete using (auth.uid() = user_id);
