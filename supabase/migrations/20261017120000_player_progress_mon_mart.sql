-- Progreso del jugador (XP, monedas, aciertos), su historial y la tienda pagada en MON nativo de Monad.
--
-- Mismo modelo que el resto del esquema: RLS activado y NINGUNA política. El navegador no lee ni escribe estas
-- tablas; todo pasa por la Edge Function `game` con la clave de servicio, que es quien decide cuánta XP vale
-- cada respuesta y quien comprueba en la red que un pago en MON es real antes de entregar nada.
--
-- El jugador se identifica por su wallet: conectar → firmar el nonce (acción `wallet`) → sesión ligada a
-- public.trainers.wallet. Todo lo de aquí cuelga de trainers(id).

-- ---------------------------------------------------------------- progreso
create table public.player_progress (
  trainer_id   uuid primary key references public.trainers(id) on delete cascade,
  xp           integer not null default 0 check (xp >= 0),
  coins        integer not null default 200 check (coins >= 0),
  correct      integer not null default 0,
  wrong        integer not null default 0,
  streak       integer not null default 0,           -- racha en curso (la lleva el servidor, no el cliente)
  best_streak  integer not null default 0,
  battles_won  integer not null default 0,
  battles_lost integer not null default 0,
  catches      integer not null default 0,
  notes        text[] not null default '{}',          -- ids de profesores atrapados (el cuaderno del perfil)
  badges       smallint not null default 0,           -- bitmap de jefes del Coliseo Monad derrotados
  mon_spent    numeric not null default 0,            -- wei de MON gastados en el Mart
  imported     boolean not null default false,        -- ya subió el progreso que tenía en el navegador
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index player_progress_xp_idx on public.player_progress (xp desc);

-- ---------------------------------------------------------------- historial
-- Todo lo que dio o costó algo, en orden. Es lo que pinta "Actividad reciente" y lo que permite auditar.
create table public.player_history (
  id         bigserial primary key,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  kind       text not null check (kind in ('answer', 'battle', 'catch', 'purchase', 'coin_purchase', 'badge', 'level', 'import')),
  text       text not null,
  xp         integer not null default 0,
  coins      integer not null default 0,
  meta       jsonb not null default '{}',
  tx_hash    text check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index player_history_trainer_idx on public.player_history (trainer_id, created_at desc);

-- Cada respuesta del Coliseo, una fila. Sirve para estadísticas por pregunta (cuáles se fallan más) y para
-- frenar a quien intente farmear XP mandando respuestas en bucle.
create table public.quiz_answers (
  id          bigserial primary key,
  trainer_id  uuid not null references public.trainers(id) on delete cascade,
  boss        smallint not null check (boss between 0 and 2),
  question_id text not null,
  ok          boolean not null,
  streak      integer not null default 0,
  created_at  timestamptz not null default now()
);
create index quiz_answers_trainer_idx on public.quiz_answers (trainer_id, created_at desc);
create index quiz_answers_question_idx on public.quiz_answers (question_id, ok);

-- ---------------------------------------------------------------- Poké Mart en MON
-- El catálogo vive en la base para poder cambiar precios sin redesplegar. `onchain_id` es el id del objeto
-- en el contrato PokeMart (contracts/PokeMart.sol); price_mon tiene que coincidir con price[onchain_id].
create table public.mart_catalog (
  item       text primary key,
  onchain_id smallint unique not null check (onchain_id between 0 and 255),
  name       text not null,
  balls      jsonb not null default '{}',             -- {"ball":10} … lo que se entrega
  buff       text,                                     -- 'radar' …
  minutes    integer,
  price_mon  numeric not null check (price_mon > 0),   -- en MON (18 decimales al cobrar)
  price_coins integer,                                  -- precio alternativo en monedas del juego (null = solo MON)
  active     boolean not null default true,
  sort       smallint not null default 0
);

insert into public.mart_catalog (item, onchain_id, name, balls, buff, minutes, price_mon, price_coins, sort) values
  ('ball1',  0, 'Grass Ball',     '{"ball":1}',   null,    null, 0.002, 5,   0),
  ('ball10', 1, 'Grass Ball ×10', '{"ball":10}',  null,    null, 0.015, 40,  1),
  ('super1', 2, 'Super Ball',     '{"super":1}',  null,    null, 0.005, 18,  2),
  ('super5', 3, 'Super Ball ×5',  '{"super":5}',  null,    null, 0.02,  80,  3),
  ('hyper1', 4, 'Hyper Ball',     '{"hyper":1}',  null,    null, 0.01,  45,  4),
  ('hyper3', 5, 'Hyper Ball ×3',  '{"hyper":3}',  null,    null, 0.025, 120, 5),
  ('hood',   6, 'Hood Ball',      '{"hood":1}',   null,    null, 0.04,  200, 6),
  ('radar',  7, 'Rare Radar',     '{}',           'radar', 20,   0.012, 60,  7);

-- Cada pago en MON se canjea una sola vez: tx_hash es la clave, así que repetir el hash no da más bolas.
-- `via`: 'contract' si se pagó con PokeMart.buy (se lee el evento Purchased), 'transfer' si fue un envío
-- directo de MON a la tesorería (modo sin contrato desplegado).
create table public.mon_purchases (
  tx_hash    text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  wallet     text not null,
  item       text not null references public.mart_catalog(item),
  count      smallint not null default 1 check (count between 1 and 20),
  value_wei  numeric not null,
  chain_id   bigint not null,
  block      bigint not null,
  via        text not null check (via in ('contract', 'transfer')),
  order_id   bigint,                                   -- PokeMart.orders en el momento de la compra
  created_at timestamptz not null default now()
);
create index mon_purchases_trainer_idx on public.mon_purchases (trainer_id, created_at desc);
create index mon_purchases_wallet_idx on public.mon_purchases (wallet);

-- ---------------------------------------------------------------- cerrojo
alter table public.player_progress enable row level security;
alter table public.player_history enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.mart_catalog enable row level security;
alter table public.mon_purchases enable row level security;

revoke all on public.player_progress, public.player_history, public.quiz_answers, public.mart_catalog, public.mon_purchases
  from anon, authenticated;
revoke all on sequence public.player_history_id_seq, public.quiz_answers_id_seq from anon, authenticated;
grant select, insert, update on public.player_progress to service_role;
grant select, insert on public.player_history, public.quiz_answers, public.mon_purchases to service_role;
grant select on public.mart_catalog to service_role;
grant usage on sequence public.player_history_id_seq, public.quiz_answers_id_seq to service_role;

-- ---------------------------------------------------------------- operaciones atómicas
-- Sumar XP/monedas y apuntarlo en el historial en una sola transacción: si una falla, no pasa ninguna.
-- `p_patch` son contadores a sumar ({"correct":1,"catches":1}); `p_set` valores a fijar ({"streak":0}).
create or replace function public.progress_gain(
  p_trainer uuid, p_kind text, p_text text, p_xp integer, p_coins integer,
  p_patch jsonb default '{}', p_set jsonb default '{}', p_meta jsonb default '{}', p_tx text default null
) returns public.player_progress
language plpgsql security invoker set search_path = public as $$
declare
  r public.player_progress;
begin
  insert into public.player_progress (trainer_id) values (p_trainer) on conflict (trainer_id) do nothing;

  update public.player_progress set
    xp           = xp + greatest(p_xp, 0),
    coins        = greatest(coins + p_coins, 0),
    correct      = correct      + coalesce((p_patch->>'correct')::int, 0),
    wrong        = wrong        + coalesce((p_patch->>'wrong')::int, 0),
    battles_won  = battles_won  + coalesce((p_patch->>'battles_won')::int, 0),
    battles_lost = battles_lost + coalesce((p_patch->>'battles_lost')::int, 0),
    catches      = catches      + coalesce((p_patch->>'catches')::int, 0),
    mon_spent    = mon_spent    + coalesce((p_patch->>'mon_spent')::numeric, 0),
    streak       = coalesce((p_set->>'streak')::int, streak),
    best_streak  = greatest(best_streak, coalesce((p_set->>'streak')::int, 0)),
    badges       = badges | coalesce((p_set->>'badge_bit')::int, 0)::smallint,
    notes        = case when p_set ? 'note' and not (p_set->>'note' = any(notes))
                        then array_append(notes, p_set->>'note') else notes end,
    updated_at   = now()
  where trainer_id = p_trainer
  returning * into r;

  insert into public.player_history (trainer_id, kind, text, xp, coins, meta, tx_hash)
  values (p_trainer, p_kind, p_text, p_xp, p_coins, p_meta, p_tx);

  return r;
end $$;

-- Gastar monedas del juego: falla (devuelve null) si no alcanzan, sin dejar el saldo en negativo.
create or replace function public.progress_spend(p_trainer uuid, p_cost integer, p_text text, p_meta jsonb default '{}')
returns public.player_progress
language plpgsql security invoker set search_path = public as $$
declare
  r public.player_progress;
begin
  insert into public.player_progress (trainer_id) values (p_trainer) on conflict (trainer_id) do nothing;
  update public.player_progress set coins = coins - p_cost, updated_at = now()
  where trainer_id = p_trainer and coins >= p_cost
  returning * into r;
  if r.trainer_id is null then return null; end if;
  insert into public.player_history (trainer_id, kind, text, xp, coins, meta)
  values (p_trainer, 'coin_purchase', p_text, 0, -p_cost, p_meta);
  return r;
end $$;

revoke execute on function public.progress_gain(uuid, text, text, integer, integer, jsonb, jsonb, jsonb, text) from anon, authenticated, public;
revoke execute on function public.progress_spend(uuid, integer, text, jsonb) from anon, authenticated, public;
grant execute on function public.progress_gain(uuid, text, text, integer, integer, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.progress_spend(uuid, integer, text, jsonb) to service_role;

-- Tabla de clasificación por XP (solo la lee la función; expone nombre, no wallet).
create or replace view public.xp_leaderboard with (security_invoker = true) as
  select t.name, (t.wallet is not null) as has_wallet, p.xp, p.correct, p.best_streak, p.badges,
         rank() over (order by p.xp desc) as rank
  from public.player_progress p join public.trainers t on t.id = p.trainer_id;
revoke all on public.xp_leaderboard from anon, authenticated;
grant select on public.xp_leaderboard to service_role;
