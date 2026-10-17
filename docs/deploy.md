# Levantar el juego en un proyecto Supabase

Todo el estado del servidor vive en tres sitios: las **migraciones** (esquema + cron), los **secrets de la
Edge Function** (red, token, precios) y el **build del front** (a qué servidor le habla). El repo trae las
migraciones y la función; los secrets y el build hay que fijarlos en cada despliegue.

Lo que el repo **no** puede traer: `tick_url` y los secrets. Si faltan, nada falla ruidosamente — el juego
arranca con los valores por defecto de testnet y parece que funciona.

## 1. Esquema

```bash
npx supabase link --project-ref <REF>
npx supabase db push
```

### Si la base ya existe y no se construyó con `db push`

`migracion_completa.sql` (raíz del repo) es la consolidación de estas mismas migraciones, pegada a mano en
el SQL Editor. Una base montada así tiene las tablas pero el **historial de migraciones vacío**, así que
`db push` las considera todas pendientes, intenta aplicarlas desde la primera y muere en
`create table public.trainers` — ninguna lleva `if not exists`. Falla entera y no aplica nada.

Comprobar antes de pushear:

```bash
npx supabase db push --dry-run     # si lista las 10, el historial está vacío
```

En ese caso hay que marcar como aplicado lo que ya está en la base, una por una, y solo después pushear lo
nuevo:

```bash
npx supabase migration repair --status applied <version>
```

Las `<version>` son los números de los nombres de archivo (`20260927190000`, …). Marcar algo que en
realidad no esté aplicado esconde el hueco en silencio: si no tienes la certeza de que
`migracion_completa.sql` cubre esa migración, revísala antes.

`tick_secret` se siembra solo en la migración base (`gen_random_bytes`). `tick_url` no puede: depende del
proyecto. Queda vacío y **mientras esté vacío el cron no llama a nadie**, así que no entran tokens nuevos ni
evolucionan los de la Caja. En el SQL Editor:

```sql
update private.config set value = 'https://<REF>.supabase.co/functions/v1/game' where key = 'tick_url';
```

Comprobar que el cron quedó programado:

```sql
select jobname, schedule, active from cron.job where jobname = 'pokegrass-tick';
```

## 2. Secrets de la función

Dieciocho variables, todas con default de **testnet**. Las que no fijes dejan el juego en Arc Testnet con
USDC, aunque la base de datos sea de producción.

```bash
npx supabase secrets set --project-ref <REF> \
  PAY_CHAIN_ID=5042 \
  PAY_CHAIN_NAME=Arc \
  PAY_RPC_URL=https://rpc.mainnet.arc.io \
  PAY_EXPLORER=https://explorer.arc.io \
  PAY_TOKEN=0x3c90aa24e33f313f3f82b27c9046ba339fb3f6b6 \
  PAY_DECIMALS=18 \
  PAY_SYMBOL=SCOUT \
  TOKEN_NAME=SCOUT \
  MART_MODE=burn \
  TREASURY_ADDRESS=0xa173321cbe5d691d0ef5241dc2fde00cdb5cdc40 \
  PRIZE_MIN_HOLD=250000
```

`MART_MODE=burn` manda los pagos a `0x…dEaD`, pero `TREASURY_ADDRESS` tiene que seguir siendo una dirección
válida: si no lo es, `martInfo()` devuelve `ready: false` y la Mart queda cerrada.

El resto (`PAY_PRICES`, `ADMIN_WALLETS`, `ARENA_DAILY`, `GOLD_CHANCE`, `MARKET_MIN_PRICE`,
`MARKET_MAX_PRICE`, `TOKEN_BUY_URL`, `TOKEN_CHART_URL`) solo hace falta si quieres apartarte del default.
Los precios por defecto ya están en unidades de SCOUT.

```bash
npx supabase functions deploy game --project-ref <REF>
```

`supabase/config.toml` fija `verify_jwt = false`. Sin eso el gateway rechaza todo antes de que la función
corra, incluidas las acciones públicas como `mart`.

## 3. Front

```
VITE_SUPABASE_URL=https://<REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_GAME_URL=https://<REF>.supabase.co/functions/v1/game
VITE_PAY_CHAIN_ID=5042
VITE_PAY_SYMBOL=SCOUT
VITE_PAY_TOKEN=0x3c90aa24e33f313f3f82b27c9046ba339fb3f6b6
VITE_PAY_DECIMALS=18
```

`VITE_GAME_URL` es obligatoria en cualquier despliegue real. Si falta, `lib/api.ts` cae a un proyecto por
defecto escrito en el código y el juego habla con otro servidor sin avisar. Las `VITE_PAY_*` solo eligen la
red de la wallet y lo que se muestra antes de que el servidor conteste — manda el servidor.

```bash
npm ci && npm run build      # queda en dist/
```

## 4. Verificar

El servidor emite una sesión y la acepta:

```bash
U=https://<REF>.supabase.co/functions/v1/game
S=$(curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"guest"}' \
  | grep -o '"session":"[a-f0-9]*"' | cut -d'"' -f4)
curl -s -X POST $U -H 'content-type: application/json' -H "x-session: $S" \
  -d '{"action":"me"}' -w '\nHTTP=%{http_code}\n' | tail -c 120
```

`HTTP=200` es lo correcto. Un `401 bad session` aquí significa que el esquema no está al día: la función lee
`sessions.seen_at` y, si la columna no existe, PostgREST responde 42703 y toda llamada con sesión se cae.
Eso es exactamente lo que dejó el juego entero sin conexión. Arreglo: `db push`.

La Mart apunta a la red correcta:

```bash
curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"mart"}'
```

Debe decir `"symbol":"SCOUT"`, `"chainId":5042`, `"mode":"burn"` y `"ready":true`. Si sale `USDC` /
`5042002`, faltan los secrets del paso 2.

El tick está vivo — `route` devuelve spawns y `now` se mueve entre llamadas:

```bash
curl -s -X POST $U -H 'content-type: application/json' -H "x-session: $S" -d '{"action":"route"}' | head -c 200
```

Vacío de forma persistente = `tick_url` sin rellenar.

## Comparar dos despliegues

Toda la config efectiva sale por un endpoint público, así que se puede diffear sin entrar a ningún panel:

```bash
for R in <REF_A> <REF_B>; do
  echo "== $R"
  curl -s -X POST "https://$R.supabase.co/functions/v1/game" \
    -H 'content-type: application/json' -d '{"action":"token"}'
done
```
