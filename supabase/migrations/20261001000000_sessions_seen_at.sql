-- 1) La tabla `sessions` nunca tuvo `seen_at`, pero el servidor la lee en cada llamada autenticada
-- (`trainerFromSession`), la refresca cuando la sesión lleva más de una hora parada y la usa para
-- caducar sesiones viejas en `cleanup()`. Sin la columna, PostgREST devuelve 42703, el `select` llega
-- vacío y toda llamada con sesión responde 401 "bad session": el juego arranca sin conexión.
alter table public.sessions add column if not exists seen_at timestamptz not null default now();

-- `cleanup()` borra por `seen_at` en cada tick; sin índice es un seq scan de toda la tabla.
create index if not exists sessions_seen_idx on public.sessions(seen_at);

-- 2) El cron del tick traía la URL del proyecto escrita a mano (20260927200000_tick_cron.sql), así que
-- en cualquier proyecto nuevo seguiría llamando al viejo. Ahora sale de private.config, igual que el
-- secreto. Hay que rellenar `tick_url` al desplegar; mientras esté vacío el job no llama a nadie.
insert into private.config (key, value) values ('tick_url', '') on conflict (key) do nothing;

do $$
begin
  perform cron.unschedule('pokegrass-tick');
exception when others then null;   -- no estaba programado: nada que quitar
end $$;

select cron.schedule('pokegrass-tick', '* * * * *', $$
  select net.http_post(
    url := (select value from private.config where key = 'tick_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-tick-secret', (select value from private.config where key = 'tick_secret')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000
  )
  where coalesce((select value from private.config where key = 'tick_url'), '') <> ''
$$);
