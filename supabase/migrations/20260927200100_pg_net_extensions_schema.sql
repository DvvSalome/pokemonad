-- pg_net no se puede mover con SET SCHEMA: se reinstala en `extensions` (sus funciones siguen en `net`).
drop extension if exists pg_net;
create extension pg_net schema extensions;
