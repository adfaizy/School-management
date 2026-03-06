-- School Management App - Supabase schema
-- Run this in Supabase Dashboard → SQL Editor

-- Schools table: one row per school with all its data as JSONB
create table if not exists public.schools (
  id text primary key,
  name text not null default 'School 1',
  settings jsonb not null default '{}',
  students jsonb not null default '[]',
  timetable jsonb not null default '{}',
  exam_tm jsonb not null default '{}',
  exam_om jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Optional: updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists schools_updated_at on public.schools;
create trigger schools_updated_at
  before update on public.schools
  for each row execute function public.set_updated_at();

-- Allow anonymous read/write (use Auth + RLS in production for real users)
alter table public.schools enable row level security;

create policy "Allow all for anon (dev)"
  on public.schools for all
  to anon
  using (true)
  with check (true);
