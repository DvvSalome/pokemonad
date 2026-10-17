-- Salvajes desde DexScreener: cuándo lo devolvió DexScreener por última vez (caché con TTL del tick y
-- filtro de "en la hierba"). La tabla ya tiene RLS; solo el service_role (Edge Function) escribe.
alter table public.tokens add column if not exists ds_seen_at timestamptz;
create index if not exists tokens_ds_seen_idx on public.tokens(ds_seen_at desc);
alter table public.tokens enable row level security;
