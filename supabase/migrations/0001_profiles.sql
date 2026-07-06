create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal text not null check (goal in ('lose', 'gain', 'recomp')),
  rate_lb_per_week numeric not null default 0,
  gym_days int not null default 0,
  activity_level text not null check (
    activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')
  ),
  height_cm numeric not null,
  weight_kg numeric not null,
  age int not null,
  sex text not null check (sex in ('male', 'female')),
  cuisines text[] not null default '{}',
  budget_level text,
  exclusions text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can select own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);
