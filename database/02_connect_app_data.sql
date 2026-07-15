-- Run once in Supabase SQL Editor before deploying the database-backed app.

alter table public.profiles add column if not exists start_weight_kg numeric;
alter table public.profiles add column if not exists current_weight_kg numeric;
alter table public.profiles add column if not exists target_weight_kg numeric;
alter table public.profiles add column if not exists daily_calories integer;
alter table public.profiles add column if not exists meal_count integer default 3;
alter table public.profiles add column if not exists sensitivities text[] default '{}';
alter table public.profiles add column if not exists reminders text[] default '{}';

create table if not exists public.daily_water (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  water_date date not null,
  amount_ml integer not null default 0 check (amount_ml >= 0 and amount_ml <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, water_date)
);

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.meals enable row level security;
alter table public.body_measurements enable row level security;
alter table public.daily_water enable row level security;

drop policy if exists "profiles_own_rows" on public.profiles;
create policy "profiles_own_rows" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "goals_own_rows" on public.goals;
create policy "goals_own_rows" on public.goals for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "meals_own_rows" on public.meals;
create policy "meals_own_rows" on public.meals for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "measurements_own_rows" on public.body_measurements;
create policy "measurements_own_rows" on public.body_measurements for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "daily_water_own_rows" on public.daily_water;
create policy "daily_water_own_rows" on public.daily_water for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists meals_user_date_idx on public.meals (user_id, meal_date desc);
create index if not exists daily_water_user_date_idx on public.daily_water (user_id, water_date desc);
create index if not exists measurements_user_created_idx on public.body_measurements (user_id, created_at desc);
