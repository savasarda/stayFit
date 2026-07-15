-- Run once in Supabase SQL Editor before deploying this feature.

alter table public.meals add column if not exists protein_g numeric not null default 0 check (protein_g >= 0);
alter table public.meals add column if not exists carbs_g numeric not null default 0 check (carbs_g >= 0);
alter table public.meals add column if not exists fat_g numeric not null default 0 check (fat_g >= 0);
alter table public.meals add column if not exists is_favorite boolean not null default false;

create index if not exists meals_user_favorite_idx
  on public.meals (user_id, is_favorite)
  where is_favorite = true;
