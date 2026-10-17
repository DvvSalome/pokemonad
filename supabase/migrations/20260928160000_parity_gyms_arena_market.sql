-- Paridad con el original: equipo, medallas de gimnasio, arena por rating, combates de equipo, mercado de cartas
-- pagado wallet a wallet y más categorías de premio (captura de la semana, dorado, legendario, hitos del Dex).
-- Todo cerrado al público (RLS sin políticas): solo la Edge Function `game` con la clave de servicio.

alter table public.trainers
  add column if not exists team jsonb not null default '[]'::jsonb,
  add column if not exists badges jsonb not null default '[]'::jsonb,
  add column if not exists elo integer not null default 1000;
create index if not exists trainers_elo_idx on public.trainers (elo desc);

-- Mejor captura de la semana (market cap del token atrapado) para el premio "captura de la semana".
alter table public.week_scores
  add column if not exists best_mcap double precision not null default 0,
  add column if not exists best_name text;

create or replace function public.week_best(tid uuid, wk integer, mc double precision, nm text)
returns void language sql set search_path = public as $$
  insert into public.week_scores as s (trainer_id, week_id, best_mcap, best_name) values (tid, wk, mc, nm)
  on conflict (trainer_id, week_id) do update
    set best_mcap = greatest(s.best_mcap, excluded.best_mcap),
        best_name = case when excluded.best_mcap > s.best_mcap then excluded.best_name else s.best_name end
$$;

-- Combate de equipo en curso (gimnasio o arena): uno por entrenador, el servidor guarda todo el estado.
create table if not exists public.duels (
  trainer_id uuid primary key references public.trainers(id) on delete cascade,
  kind text not null check (kind in ('gym', 'arena')),
  ref text not null,
  state jsonb not null,
  started_at timestamptz not null default now()
);
alter table public.duels enable row level security;

-- Mercado de cartas: el comprador paga al vendedor directo (transfer ERC-20); el servidor lo verifica y mueve la carta.
create table if not exists public.market (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.trainers(id) on delete cascade,
  seller_wallet text not null check (seller_wallet ~ '^0x[0-9a-f]{40}$'),
  box_id bigint not null,
  spawn_id text not null,
  name text not null, tier text, shiny boolean not null default false, stage smallint, model text, species_id text,
  token text, symbol text, logo text,
  price text not null,
  pay_token text not null, chain_id bigint not null,
  status text not null default 'open' check (status in ('open', 'sold', 'cancelled')),
  reserved_by uuid, reserved_until timestamptz,
  buyer_id uuid, tx_hash text unique check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(), sold_at timestamptz
);
create unique index if not exists market_one_open_per_card on public.market (box_id) where status = 'open';
create index if not exists market_open_idx on public.market (created_at desc) where status = 'open';
alter table public.market enable row level security;

-- Vender una carta, de forma atómica: la carta sigue siendo del vendedor, el comprador no la tiene ya, y la reserva
-- es de quien pagó. Mueve la carta y cierra la venta (y las ofertas de intercambio que la usaban).
create or replace function public.market_settle(p_id uuid, p_buyer uuid, p_tx text)
returns text language plpgsql set search_path = public as $$
declare
  l public.market;
  b public.box;
begin
  select * into l from public.market where id = p_id for update;
  if not found then return 'no such listing'; end if;
  if l.status <> 'open' then return 'that card is no longer for sale'; end if;
  if l.reserved_by is distinct from p_buyer then return 'reserve the card before paying'; end if;
  select * into b from public.box where id = l.box_id and trainer_id = l.seller_id for update;
  if b.id is null then update public.market set status = 'cancelled' where id = p_id; return 'the seller no longer has that card'; end if;
  if exists (select 1 from public.box where trainer_id = p_buyer and (spawn_id = b.spawn_id or (b.token is not null and token = b.token))) then
    return 'you already have that monster';
  end if;
  update public.box set trainer_id = p_buyer where id = b.id;
  update public.market set status = 'sold', buyer_id = p_buyer, tx_hash = p_tx, sold_at = now() where id = p_id;
  update public.trades set status = 'cancelled' where status = 'pending'
    and ((from_id = l.seller_id and give = b.spawn_id) or (to_id = l.seller_id and want = b.spawn_id));
  update public.trainers set team = coalesce((select jsonb_agg(x) from jsonb_array_elements_text(team) x where x <> b.spawn_id), '[]'::jsonb)
    where id = l.seller_id;
  return 'ok';
end $$;
revoke all on function public.market_settle(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.week_best(uuid, integer, double precision, text) from public, anon, authenticated;
grant execute on function public.market_settle(uuid, uuid, text) to service_role;
grant execute on function public.week_best(uuid, integer, double precision, text) to service_role;

-- Premios nuevos. `ref` evita pagar dos veces lo mismo (p. ej. 'dex:25:<trainer>', 'gold:<evento>', 'legend:<franja>').
alter table public.prizes drop constraint if exists prizes_category_check;
alter table public.prizes add constraint prizes_category_check
  check (category = any (array['league', 'arena', 'discoverer', 'catch', 'golden', 'legendary', 'dex']));
alter table public.prizes add column if not exists ref text;
create unique index if not exists prizes_ref_key on public.prizes (ref) where ref is not null;
