-- Shared calorie estimates used before calling OpenAI.
-- Run once in Supabase SQL Editor before 04_shared_calorie_estimate_rpc.sql.

create table if not exists public.shared_calorie_estimates (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  food_name text not null,
  amount numeric not null check (amount > 0),
  unit text not null,
  meal_name text not null,
  portion text not null,
  total_calories integer not null check (total_calories >= 0),
  calorie_min integer not null check (calorie_min >= 0),
  calorie_max integer not null check (calorie_max >= 0),
  confidence integer not null check (confidence >= 0 and confidence <= 100),
  feedback text not null default '',
  source text not null default 'api' check (source in ('api', 'local')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  use_count integer not null default 1 check (use_count >= 0)
);

alter table public.shared_calorie_estimates enable row level security;

drop policy if exists "shared_calorie_estimates_read_authenticated" on public.shared_calorie_estimates;
create policy "shared_calorie_estimates_read_authenticated" on public.shared_calorie_estimates
  for select to authenticated
  using (true);

create index if not exists shared_calorie_estimates_cache_key_idx on public.shared_calorie_estimates (cache_key);
create index if not exists shared_calorie_estimates_food_name_idx on public.shared_calorie_estimates (food_name);
