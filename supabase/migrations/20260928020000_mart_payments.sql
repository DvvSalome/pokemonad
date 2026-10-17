-- Pagos de la Mart con token ERC-20. Cada transacción se canjea una sola vez (tx_hash es la clave), así que
-- repetir el mismo hash no vuelve a dar objetos. Solo la Edge Function (clave de servicio) lee o escribe aquí.
create table public.payments (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  item text not null,
  wallet text not null,
  token text not null,
  chain_id bigint not null,
  amount numeric not null,
  block bigint not null,
  created_at timestamptz not null default now()
);
create index payments_trainer_idx on public.payments (trainer_id, created_at desc);

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;
grant select, insert on public.payments to service_role;
