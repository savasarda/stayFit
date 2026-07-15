-- Allows the API server to write shared calorie estimates without exposing broad table writes.
-- Run once in Supabase SQL Editor after 03_create_shared_calorie_estimates.sql.

create or replace function public.upsert_shared_calorie_estimate(
  p_cache_key text,
  p_food_name text,
  p_amount numeric,
  p_unit text,
  p_meal_name text,
  p_portion text,
  p_total_calories integer,
  p_calorie_min integer,
  p_calorie_max integer,
  p_confidence integer,
  p_feedback text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.shared_calorie_estimates (
    cache_key,
    food_name,
    amount,
    unit,
    meal_name,
    portion,
    total_calories,
    calorie_min,
    calorie_max,
    confidence,
    feedback,
    source,
    updated_at,
    last_used_at,
    use_count
  )
  values (
    left(trim(p_cache_key), 300),
    left(trim(p_food_name), 240),
    p_amount,
    left(trim(p_unit), 40),
    left(trim(p_meal_name), 240),
    left(trim(p_portion), 120),
    greatest(p_total_calories, 0),
    greatest(p_calorie_min, 0),
    greatest(p_calorie_max, 0),
    least(greatest(p_confidence, 0), 100),
    left(coalesce(p_feedback, ''), 1200),
    case when p_source = 'local' then 'local' else 'api' end,
    now(),
    now(),
    1
  )
  on conflict (cache_key) do update set
    food_name = excluded.food_name,
    amount = excluded.amount,
    unit = excluded.unit,
    meal_name = excluded.meal_name,
    portion = excluded.portion,
    total_calories = excluded.total_calories,
    calorie_min = excluded.calorie_min,
    calorie_max = excluded.calorie_max,
    confidence = excluded.confidence,
    feedback = excluded.feedback,
    source = excluded.source,
    updated_at = now(),
    last_used_at = now(),
    use_count = public.shared_calorie_estimates.use_count + 1;
end;
$$;

create or replace function public.touch_shared_calorie_estimate(p_cache_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shared_calorie_estimates
  set last_used_at = now(),
      use_count = use_count + 1
  where cache_key = p_cache_key;
end;
$$;

create or replace function public.get_shared_calorie_estimate(p_cache_key text)
returns table (
  meal_name text,
  portion text,
  unit text,
  total_calories integer,
  calorie_min integer,
  calorie_max integer,
  confidence integer,
  feedback text,
  use_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    sce.meal_name,
    sce.portion,
    sce.unit,
    sce.total_calories,
    sce.calorie_min,
    sce.calorie_max,
    sce.confidence,
    sce.feedback,
    sce.use_count
  from public.shared_calorie_estimates sce
  where sce.cache_key = p_cache_key
  limit 1;
end;
$$;

grant execute on function public.upsert_shared_calorie_estimate(text, text, numeric, text, text, text, integer, integer, integer, integer, text, text) to anon, authenticated;
grant execute on function public.touch_shared_calorie_estimate(text) to anon, authenticated;
grant execute on function public.get_shared_calorie_estimate(text) to anon, authenticated;
