# Paridad con PokeGrass original (pokegrass.com)

Auditoría del 28-09-2026: se recorrió pokegrass.com como invitado (sin conectar wallet ni firmar nada) y se leyó lo
que su propio cliente expone: `launch.json` (niveles, premios, comisiones) y las acciones de `/api/trainer`
(`team`, `arena`, `battlestart/battlemove`, `marketlist/unlist/quote/buy`, `itemquote`, `useitem`, `shopquote/shopclaim`,
`daily`, `pos`, `trade`…), `/api/rewards` (`closeweek/paid/quote/void`), `/api/share` y `/api/board?view=gyms`.

Leyenda: ✅ lo tenemos y funciona · ⚠️ a medias · ❌ no lo teníamos. La columna **Ahora** es el estado tras este trabajo.

## Tabla

| Funcionalidad | Original | Nosotros (antes) | Ahora | Plan / cómo quedó |
|---|---|---|---|---|
| Salvajes = tokens reales de la cadena, evolución por market cap | ✅ | ✅ | ✅ | Sin cambios (DexScreener, server v8). |
| Captura, bolas, combate contra salvajes | ✅ | ✅ | ✅ | Sin cambios. |
| Mart pagada con el token (verificada en la red) | ✅ | ✅ | ✅ | Sin cambios (server v7). |
| Regalo diario, más bolas por wallet / nivel de holder | ✅ | ✅ | ✅ | Sin cambios. |
| Misiones diarias/semanales, huevos, referidos | ✅ | ✅ | ✅ | Sin cambios. |
| Intercambio carta por carta | ✅ | ✅ | ✅ | Ahora bloquea las cartas puestas a la venta. |
| Liga semanal (puntos) + arena + descubridor con premio en token | ✅ | ✅ | ✅ | Sin cambios; los premios los paga el admin y se verifican en la red. |
| **Equipo de hasta 3** | ✅ (`team`) | ❌ | ✅ | Pestaña Equipo en ⚔️ Combates; el servidor guarda `trainers.team`. |
| **8 Gimnasios con medallas** (líderes = monedas grandes) | ✅ | ❌ | ✅ | Líderes = los 8 tokens de más market cap en Arc ahora mismo. Medallas en orden; premio la 1.ª vez (bolas + puntos) y revancha 1/día. |
| **Arena por rating contra equipos de otros entrenadores** | ✅ | ⚠️ (solo contaban victorias contra salvajes) | ✅ | Combate 3v3 contra el equipo real de otro jugador, Elo (K=32), rivales de rating parecido, 15 combates/día. Solo cuenta la victoria semanal 1 vez por rival y día; rendirse = derrota. Las victorias contra salvajes ya no suman a la arena. |
| **Mercado de cartas pagado wallet a wallet** | ✅ | ❌ | ✅ | Vender a precio fijo en el token; el comprador reserva 15 min, paga directamente a la wallet del vendedor y el servidor verifica la transferencia en la red antes de mover la carta (atómico, un tx por compra). |
| **Legendarios con horario en Legend Summit, gratis para holders** | ✅ | ⚠️ (solo con Summit Pass pagado) | ✅ | Uno cada 2 h durante 30 min, igual para todos; gratis para cualquier nivel de holder o con Summit Pass. Horario y Salón de la Fama en ⚔️ → Legendarios. |
| **Premios instantáneos**: dorado, legendario, hitos del Dex | ✅ (`golden`, `legendary`, `dex`) | ❌ | ✅ | Quedan en `prizes` como pendientes (el admin paga y se verifica en la red). Requieren wallet con el mínimo. Los hitos del Dex dan además bolas a todos. |
| **Captura de la semana** (mayor market cap atrapado) | ✅ (`catchOfWeek`) | ❌ | ✅ | Nueva categoría `catch` al cerrar la semana (`week_scores.best_mcap`). |
| **Ventajas extra por holdear** (bonus de liga, Radar permanente, Summit gratis) | ✅ | ⚠️ (solo bolas y shiny) | ✅ | Ace +5 % puntos de liga; Veteran +10 % y Radar; Champion +20 % y Radar. Todos: Legend Summit gratis. `HOLD_PERKS`. |
| **Evento de temporada** (Ghost Week) | ✅ | ❌ | ✅ | `SEASON_EVENT` (por defecto Ghost Week 24-10 → 2-11, puntos de captura ×2). |
| **Lista pública de tokens descubiertos** | ✅ | ❌ | ✅ | Dex → pestaña "Tokens descubiertos" (quién lo descubrió, capturas). |
| **Compartir carta en X** | ✅ (`/api/share`) | ❌ | ✅ | Botón Compartir en la carta: Web Share con imagen o descarga + intent de X con tu enlace de invitación. |
| **Página pública de premios con transacciones** | ✅ | ⚠️ | ✅ | Liga → ganadores con enlace al tx en el explorador. |
| **Invitado → wallet conserva la Caja** | ✅ | ⚠️ (si la wallet ya tenía cuenta, se perdía) | ✅ | Al entrar con una wallet que ya tenía entrenador, la Caja del invitado se mueve a esa cuenta (sin duplicados). |
| **Instalar como app (PWA)** | ✅ | ❌ | ✅ | `manifest.webmanifest` + iconos + botón "Instalar app" en el menú (iOS: instrucciones). |
| Día/noche en la ruta | ✅ | ❌ | ❌ | Es del agente de visuales del mundo (no se tocan sus archivos). |
| Animación de evolución | ✅ | ⚠️ (aviso) | ⚠️ | Sigue el aviso; la animación 3D es del agente de visuales. |
| "Hierba temprana" para holders | ✅ | ❌ | ❌ | En el original es acceso anticipado a lanzamientos; aquí los salvajes salen de DexScreener para todos a la vez. Sin equivalente honesto. |

## Qué necesita del usuario

Nada para testnet: todo funciona con USDC de Arc testnet (faucet de Circle). Para cobrar premios instantáneos hace
falta una wallet con al menos `PRIZE_MIN_HOLD` y que el admin los pague desde el panel de admin (firma el admin).

## Pasar a mainnet (solo secrets / env)

Servidor (secrets de la función `game` en Supabase):

- `PAY_CHAIN_ID=5042`, `PAY_CHAIN_NAME`, `PAY_RPC_URL`, `PAY_EXPLORER`, `PAY_TOKEN`, `PAY_DECIMALS`, `PAY_SYMBOL`, `PAY_PRICES`
- `TREASURY_ADDRESS`, `MART_MODE=burn`, `TOKEN_NAME`, `TOKEN_BUY_URL`, `TOKEN_CHART_URL`
- `HOLD_TIERS`, `HOLD_PERKS`, `PRIZE_MIN_HOLD`, `ADMIN_WALLETS`
- `PRIZES` (incluye `catch`), `PRIZE_BOUNTIES` (`golden`, `legendary`, `dex`)
- `MARKET_MIN_PRICE`, `MARKET_MAX_PRICE`, `GYM_LEVELS`, `ARENA_DAILY`, `SEASON_EVENT`

Con `PAY_CHAIN_ID=5042` los valores por defecto ya pasan a los de mainnet (premios y precios del mercado en millones
de tokens, como el original). Cliente (Vercel): las `VITE_PAY_*` de siempre.
