-- Cinco columnas que el servidor lee y escribe en cada partida pero que ninguna migración llegó a crear
-- (mismo caso que `sessions.seen_at`): el tipo `Trainer` de la Edge Function las declara y el código las
-- usa, así que PostgREST respondía 500 "Could not find the 'missions' column of 'trainers'" y el sistema
-- de misiones quedaba muerto. Huevos, caminata y claves de recuperación fallaban por lo mismo, solo que
-- en silencio: `t.eggs ?? []` y `t.walked ?? 0` disimulan la columna ausente hasta que toca guardar.
alter table public.trainers
  -- rollMissions() guarda aquí el progreso diario y semanal
  add column if not exists missions jsonb not null default '{}'::jsonb,
  -- [{id, kind, start, at}] — la mochila de huevos, ver quests.ts
  add column if not exists eggs jsonb not null default '[]'::jsonb,
  -- metros acumulados; lleva decimales porque walk() suma la distancia real recorrida
  add column if not exists walked numeric not null default 0,
  add column if not exists walk_at timestamptz,
  -- solo la huella sha256 de la clave de recuperación; la clave en claro se enseña una vez y no se guarda
  add column if not exists recovery_hash text;

-- recoverAccount() entra buscando por esta huella: sin índice es un seq scan de todos los entrenadores.
create index if not exists trainers_recovery_idx on public.trainers(recovery_hash) where recovery_hash is not null;
