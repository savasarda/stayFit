create extension if not exists pgcrypto;

create table if not exists public.exceptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('client', 'server', 'react', 'api')),
  severity text not null default 'error' check (severity in ('info', 'warning', 'error', 'fatal')),
  message text not null,
  stack text,
  url text,
  method text,
  user_agent text,
  context jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_at timestamptz
);

create index if not exists exceptions_created_at_idx on public.exceptions (created_at desc);
create index if not exists exceptions_resolved_idx on public.exceptions (resolved, created_at desc);

alter table public.exceptions enable row level security;

drop policy if exists "allow_exception_inserts" on public.exceptions;
create policy "allow_exception_inserts"
on public.exceptions for insert
to anon, authenticated
with check (true);

comment on table public.exceptions is 'Central application error and exception log.';
