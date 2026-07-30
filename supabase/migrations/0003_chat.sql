-- Phase 2: persisted assistant conversations.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'foodie' is accepted now so Phase 2's second half needs no migration.
  assistant text not null check (assistant in ('coach', 'foodie')),
  created_at timestamptz not null default now(),
  -- One ongoing conversation per assistant per user. The Coach is a continuing
  -- relationship, not a series of disposable threads; dropping this constraint
  -- later is what enables multiple named threads.
  unique (user_id, assistant)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Denormalized so the RLS policy is a column comparison rather than an
  -- EXISTS subquery per row -- same reasoning as meal_items.
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Users can select own conversations"
  on public.conversations for select using (auth.uid() = user_id);
create policy "Users can insert own conversations"
  on public.conversations for insert with check (auth.uid() = user_id);
create policy "Users can update own conversations"
  on public.conversations for update using (auth.uid() = user_id);
create policy "Users can delete own conversations"
  on public.conversations for delete using (auth.uid() = user_id);

create policy "Users can select own messages"
  on public.messages for select using (auth.uid() = user_id);
create policy "Users can insert own messages"
  on public.messages for insert with check (auth.uid() = user_id);
create policy "Users can update own messages"
  on public.messages for update using (auth.uid() = user_id);
create policy "Users can delete own messages"
  on public.messages for delete using (auth.uid() = user_id);
