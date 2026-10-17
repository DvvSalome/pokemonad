-- Niveles por holdear, premios semanales con panel de admin, eventos (Monstruo Dorado), intercambios y
-- referidos. Como el resto: RLS sin políticas, solo la Edge Function (service_role) lee y escribe.

-- Caché del saldo del token de la wallet (balanceOf) y referidos.
alter table public.trainers
  add column if not exists hold_bal numeric,
  add column if not exists hold_at timestamptz,
  add column if not exists ref_code text unique,
  add column if not exists referred_by uuid references public.trainers(id) on delete set null,
  add column if not exists ref_paid boolean not null default false;

-- Puntos, victorias de arena y descubrimientos por semana (el cierre semanal lee de aquí).
create table public.week_scores (
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  week_id integer not null,
  points integer not null default 0,
  wins integer not null default 0,
  disc integer not null default 0,
  primary key (trainer_id, week_id)
);
create index week_scores_week_idx on public.week_scores (week_id, points desc);
insert into public.week_scores (trainer_id, week_id, points)
  select id, week_id, week_points from public.trainers where week_points > 0 on conflict do nothing;

create or replace function public.week_add(tid uuid, wk integer, pts integer, w integer, d integer) returns void
language sql security invoker set search_path = public as $$
  insert into public.week_scores as s (trainer_id, week_id, points, wins, disc) values (tid, wk, pts, w, d)
  on conflict (trainer_id, week_id) do update
    set points = s.points + excluded.points, wins = s.wins + excluded.wins, disc = s.disc + excluded.disc
$$;

-- Premios: una fila por ganador y categoría. El admin paga desde su wallet y aquí queda el hash verificado.
create table public.prizes (
  id bigserial primary key,
  week_id integer not null,
  category text not null check (category in ('league', 'arena', 'discoverer')),
  rank integer not null,
  trainer_id uuid references public.trainers(id) on delete set null,
  name text not null,
  wallet text,
  score integer not null,
  amount text not null,           -- en unidades del token (p. ej. '10'), como PAY_PRICES
  token text not null,
  chain_id bigint not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  tx_hash text unique check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  paid_by text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (week_id, category, rank)
);

-- Wallets de admin además de la variable ADMIN_WALLETS (en minúsculas).
create table public.admins (wallet text primary key check (wallet ~ '^0x[0-9a-f]{40}$'), note text);

-- Eventos globales con un solo ganador (Monstruo Dorado).
create table public.events (
  id text primary key,
  kind text not null,
  line text not null,
  x double precision not null,
  z double precision not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  caught_by uuid references public.trainers(id) on delete set null,
  caught_name text
);
create index events_ends_idx on public.events (ends_at desc);

-- Intercambios: A ofrece su `give` por el `want` de B; B acepta y el cambio es atómico (trade_accept).
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.trainers(id) on delete cascade,
  to_id uuid not null references public.trainers(id) on delete cascade,
  give text not null,
  want text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'declined', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index trades_to_idx on public.trades (to_id, status);
create index trades_from_idx on public.trades (from_id, status);

-- El cambio en sí: bloquea la oferta y las dos cartas, comprueba dueños y que nadie acabe con el mismo token dos veces.
create or replace function public.trade_accept(p_id uuid, p_to uuid) returns text
language plpgsql security invoker set search_path = public as $$
declare
  t public.trades;
  a public.box;
  b public.box;
begin
  select * into t from public.trades where id = p_id for update;
  if not found or t.to_id <> p_to then return 'no such offer'; end if;
  if t.status <> 'pending' then return 'that offer is closed'; end if;
  if t.created_at < now() - interval '1 day' then update public.trades set status = 'cancelled' where id = p_id; return 'that offer expired'; end if;
  select * into a from public.box where trainer_id = t.from_id and spawn_id = t.give for update;
  select * into b from public.box where trainer_id = t.to_id and spawn_id = t.want for update;
  if a.id is null or b.id is null then update public.trades set status = 'failed' where id = p_id; return 'one of the monsters is gone'; end if;
  if exists (select 1 from public.box where trainer_id = t.to_id and spawn_id = a.spawn_id)
     or exists (select 1 from public.box where trainer_id = t.from_id and spawn_id = b.spawn_id)
     or (a.token is not null and exists (select 1 from public.box where trainer_id = t.to_id and token = a.token and id <> b.id))
     or (b.token is not null and exists (select 1 from public.box where trainer_id = t.from_id and token = b.token and id <> a.id)) then
    update public.trades set status = 'failed' where id = p_id; return 'one of you already has that monster';
  end if;
  update public.box set trainer_id = t.to_id where id = a.id;
  update public.box set trainer_id = t.from_id where id = b.id;
  update public.trades set status = 'done', done_at = now() where id = p_id;
  -- otras ofertas pendientes con estas cartas ya no valen
  update public.trades set status = 'cancelled'
    where status = 'pending' and id <> p_id and (give in (a.spawn_id, b.spawn_id) or want in (a.spawn_id, b.spawn_id));
  return 'ok';
end $$;

alter table public.week_scores enable row level security;
alter table public.prizes enable row level security;
alter table public.admins enable row level security;
alter table public.events enable row level security;
alter table public.trades enable row level security;
revoke all on public.week_scores, public.prizes, public.admins, public.events, public.trades from anon, authenticated;
grant select, insert, update, delete on public.week_scores, public.prizes, public.admins, public.events, public.trades to service_role;
grant usage, select on sequence public.prizes_id_seq to service_role;
revoke execute on function public.week_add(uuid, integer, integer, integer, integer) from anon, authenticated, public;
revoke execute on function public.trade_accept(uuid, uuid) from anon, authenticated, public;
grant execute on function public.week_add(uuid, integer, integer, integer, integer) to service_role;
grant execute on function public.trade_accept(uuid, uuid) to service_role;

-- El saldo (hasta 18 decimales) como texto, para no perder precisión en JSON; y la marca de semana cerrada.
alter table public.trainers alter column hold_bal type text using hold_bal::text;
create table public.week_closes (week_id integer primary key, closed_at timestamptz not null default now(), closed_by text, winners integer not null default 0, skipped integer not null default 0);
alter table public.week_closes enable row level security;
revoke all on public.week_closes from anon, authenticated;
grant select, insert, update, delete on public.week_closes to service_role;
