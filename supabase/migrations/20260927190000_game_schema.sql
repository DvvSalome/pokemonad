-- Backend de PokeGrass Arc Edition. Todo el acceso pasa por la Edge Function `game` (clave de servicio):
-- las tablas tienen RLS activado y NINGUNA política, así que el navegador (anon/authenticated) no puede
-- leer ni escribir nada directamente. Así el servidor es la única autoridad sobre capturas, bolas y puntos.

create extension if not exists pgcrypto;

-- Entrenadores (invitados o con wallet de Arc).
create table public.trainers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  wallet text unique,
  balls jsonb not null default '{"ball":5,"super":2,"hyper":0,"hood":1}',
  buffs jsonb not null default '{}',          -- { radar|charm|revive: epoch ms hasta cuándo }
  daily jsonb not null default '{}',          -- { base: 'YYYY-MM-DD', wallet: 'YYYY-MM-DD' }
  extra jsonb not null default '[]',          -- salvajes privados de Lure/Safari: [{id,line,expiresAt}]
  stats jsonb not null default '{"throws":0,"catches":0,"shinies":0,"disc":0}',
  score integer not null default 0,           -- puntos de liga totales
  week_id integer not null default 0,
  week_points integer not null default 0,     -- puntos de liga de la semana en curso
  imported boolean not null default false,    -- ya subió su partida local (una sola vez)
  last_throw timestamptz,
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);

-- Sesiones: el navegador guarda un token aleatorio; aquí solo su sha256.
create table public.sessions (
  token_hash text primary key,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index sessions_trainer_idx on public.sessions(trainer_id);

-- Nonces para firmar con la wallet (entrar con Arc).
create table public.nonces (
  address text primary key,
  nonce text not null,
  expires_at timestamptz not null
);

-- Tokens de Arc vistos (el feed cacheado por el tick) y sus contadores de juego.
create table public.tokens (
  address text primary key,
  symbol text not null,
  name text not null,
  logo text,
  mcap double precision not null default 0,
  liquidity double precision not null default 0,
  launched_at timestamptz not null default now(),
  hot boolean not null default false,
  line text not null,
  stage smallint not null default 1,
  dex_no integer unique,                      -- orden de descubrimiento global
  first_trainer uuid references public.trainers(id) on delete set null,
  catches integer not null default 0,
  shinies integer not null default 0,
  updated_at timestamptz not null default now()
);
create index tokens_launched_idx on public.tokens(launched_at desc);
create index tokens_hot_idx on public.tokens(hot) where hot;
create sequence public.dex_seq;

-- La Caja: cada monstruo atrapado. Con token, su nivel sale del mcap actual del token vs m0.
create table public.box (
  id bigserial primary key,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  spawn_id text not null,                     -- t-0x… (token) o lure-… (privado)
  token text references public.tokens(address) on delete set null,
  species_id text not null,
  name text not null,
  tier text not null,
  model text not null,
  stage smallint not null default 1,
  shiny boolean not null default false,
  m0 double precision,
  discovered boolean not null default false,
  imported boolean not null default false,
  caught_at timestamptz not null default now(),
  unique (trainer_id, spawn_id)
);
create index box_trainer_idx on public.box(trainer_id);
create index box_token_idx on public.box(token);

-- Encuentro en curso (uno por entrenador): vida del salvaje y combate, resueltos en el servidor.
create table public.encounters (
  trainer_id uuid primary key references public.trainers(id) on delete cascade,
  spawn_id text not null,
  token text,
  line text not null,
  mcap double precision not null default 0,
  shiny boolean not null default false,
  foe_hp integer not null,
  foe_max integer not null,
  battle jsonb,
  started_at timestamptz not null default now()
);

-- Actividad pública: capturas, descubrimientos, shinies y evoluciones.
create table public.feed (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('catch','discover','evolve')),
  trainer_name text,
  token text,
  symbol text,
  logo text,
  species text,
  stage_from smallint,
  stage_to smallint,
  shiny boolean not null default false,
  mcap double precision
);
create index feed_at_idx on public.feed(at desc);

-- Configuración privada (secreto del tick). En un esquema no expuesto.
create schema if not exists private;
create table private.config (key text primary key, value text not null);
insert into private.config values ('tick_secret', encode(gen_random_bytes(24), 'hex'));

alter table public.trainers enable row level security;
alter table public.sessions enable row level security;
alter table public.nonces enable row level security;
alter table public.tokens enable row level security;
alter table public.box enable row level security;
alter table public.encounters enable row level security;
alter table public.feed enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- El siguiente número de Dex (lo usa la función al primer descubrimiento de un token).
create or replace function public.next_dex_no() returns integer
language sql security invoker set search_path = public as $$ select nextval('public.dex_seq')::integer $$;
revoke execute on function public.next_dex_no() from anon, authenticated, public;
