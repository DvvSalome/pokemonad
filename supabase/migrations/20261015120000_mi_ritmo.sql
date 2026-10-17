-- mi ritmo — esquema inicial.
-- Se aplica con `supabase db push`. Idempotente.

create table if not exists public.habits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  note          text,
  goal_per_week int  not null default 5 check (goal_per_week between 1 and 7),
  position      int  not null default 0,
  archived      boolean not null default false,
  is_sample     boolean not null default false,
  created_at    timestamptz not null default now()
)
create table if not exists public.habit_logs (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id  uuid not null references public.habits(id) on delete cascade,
  "date"    date not null,
  done      boolean not null default true,
  is_sample boolean not null default false,
  constraint habit_logs_habit_date_key unique (habit_id, "date")
)
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null,
  priority   text not null check (priority in ('alta','media','baja')),
  project    text,
  "date"     date not null,
  done       boolean not null default false,
  done_at    timestamptz,
  position   int  not null default 0,
  is_sample  boolean not null default false,
  created_at timestamptz not null default now()
)
create index if not exists habits_user_pos_idx      on public.habits (user_id, position)
create index if not exists habit_logs_user_date_idx on public.habit_logs (user_id, "date")
create index if not exists tasks_user_date_idx      on public.tasks (user_id, "date")
alter table public.habits     enable row level security
alter table public.habit_logs enable row level security
alter table public.tasks      enable row level security
drop policy if exists habits_propias on public.habits
create policy habits_propias on public.habits
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id)
drop policy if exists logs_propios on public.habit_logs
create policy logs_propios on public.habit_logs
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id)
drop policy if exists tareas_propias on public.tasks
create policy tareas_propias on public.tasks
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id)
-- Restos de los intentos por el editor web.
drop table if exists public.ping
drop table if exists public.diag
