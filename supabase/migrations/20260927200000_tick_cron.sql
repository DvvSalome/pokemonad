-- El tick del mundo: cada minuto pg_cron llama a la función `game` (acción tick) con el secreto de
-- private.config, que refresca tokens desde GeckoTerminal/DexScreener y apunta las evoluciones al feed.
create or replace function public.tick_secret_ok(s text) returns boolean
language sql security definer set search_path = '' stable as $$
  select exists (select 1 from private.config where key = 'tick_secret' and value = s)
$$;
revoke execute on function public.tick_secret_ok(text) from anon, authenticated, public;
grant execute on function public.tick_secret_ok(text) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('pokegrass-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://jwthfdfhzenbmtitafze.supabase.co/functions/v1/game',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-tick-secret', (select value from private.config where key = 'tick_secret')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000
  )
$$);
