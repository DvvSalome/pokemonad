# Guía Web3 de PokeGrass: qué es cada cosa, cómo lo hace el original y cómo estamos nosotros

_Revisado el 27 de septiembre de 2026, verificado contra el sitio en vivo del original (pokegrass.com), su blockchain y nuestra base de datos._

> **Aclaración de nombres.** Lo que llamamos "Polkadot" en las conversaciones es en realidad **PokeGrass original** (pokegrass.com). **Polkadot** es otra blockchain que no tiene nada que ver: ni el original ni nosotros la usamos.

---

## 1. Los conceptos, en simple

### ¿Qué es una blockchain?
Una **base de datos pública** que nadie controla solo. Miles de computadoras guardan la misma copia y se ponen de acuerdo sobre cada cambio. Consecuencias:
- **Nadie puede borrar ni alterar** lo que ya se escribió (ni el dueño del proyecto).
- **Cualquiera puede leerla**: saldos, transferencias, contratos. Todo es auditable.
- **Escribir cuesta** una pequeña comisión llamada **gas**, que se paga en la moneda nativa de esa red.

Ejemplos: Ethereum, Arbitrum, Base, **Robinhood Chain** (la del original), **Arc** (la nuestra).

### ¿Qué es una wallet?
Una app (MetaMask, Rabby, la de Robinhood, etc.) que guarda tu **llave privada**. La llave privada es lo único que prueba que una dirección (`0xABC…`) es tuya. La wallet sirve para dos cosas:
1. **Firmar mensajes** (gratis, no toca la blockchain). Sirve para decir "soy el dueño de esta dirección". Así hacemos el login.
2. **Firmar transacciones** (cuestan gas y cambian la blockchain). Sirven para pagar, comprar un token, etc.

El proyecto **nunca** debe ver la llave privada del jugador.

### ¿Qué es un token?
Un **contrato inteligente** (un programa que vive en la blockchain) que lleva una tabla de "quién tiene cuánto". El estándar más común es **ERC-20**: todos los tokens ERC-20 tienen las mismas funciones (`balanceOf`, `transfer`, `totalSupply`…), por eso cualquier wallet o exchange los entiende.
- **Dirección del contrato (CA, *contract address*)**: su identificador, p. ej. `0xa202…a4c8`. Es lo que la gente copia para comprarlo.
- **Supply**: cuántos existen. En el original son 1.000.000.000 fijos.
- **Quemar (burn)**: mandar tokens a una dirección de la que nadie tiene llave (`0x…dEaD`). Salen de circulación para siempre, lo que reduce el supply.

### ¿Qué es un DEX y un pool de liquidez?
Un **DEX** (exchange descentralizado, p. ej. Uniswap) es un contrato donde se intercambian tokens sin intermediarios. Para que un token tenga precio, alguien crea un **pool**: deposita el token + otra moneda (ETH, USDC) y el contrato fija el precio según la proporción. Cada compra/venta paga una **comisión** (fee), y parte de esa comisión puede ir al creador.

### ¿Qué es un launchpad?
Una web que te lanza el token en un clic: crea el contrato, el pool y la página de compra. El original usó **Pons** (ponsfamily.com), en Robinhood Chain.

### ¿Qué es "mainnet" y "testnet"?
- **Mainnet**: la red real, con dinero real.
- **Testnet**: una copia de práctica con monedas falsas y gratis. Todo se prueba primero ahí.

---

## 2. Cómo está montado el PokeGrass original

Verificado hoy directamente en su blockchain y en su servidor:

| Pieza | Qué usa |
|---|---|
| Blockchain | **Robinhood Chain**, chainId 4663 (una red compatible con Ethereum). Se paga el gas en ETH |
| Token | **$POKEGRASS**, ERC-20, contrato `0xa202af885a0f6a6e3fe2a3a5981448b44ae6a4c8` |
| Supply | 1.000.000.000 fijos. **~21,4 M ya quemados** (lo leí en la cadena hoy) |
| Lanzamiento | Launchpad **Pons**. Pool en **Uniswap v4** contra ETH |
| Página web | Archivos estáticos en **Vercel** |
| Servidor | **Funciones serverless de Vercel** en `/api/*` (lo confirma la cabecera `server: Vercel`) |
| Base de datos | **No se puede ver desde afuera.** El código del servidor es privado. No hay ninguna señal de que usen Supabase; lo más probable es una base propia conectada a Vercel. |
| Config pública | `pokegrass.com/launch.json`: contrato del token, link de compra, niveles de holder y tienda |

**Respuesta directa a tu pregunta:** no, no hay evidencia de que el original use Supabase. Nosotros sí usamos Supabase. Eso **no es malo**: es una forma igual de válida (y muy buena) de tener servidor + base de datos. Lo importante es la arquitectura, no la marca, y la nuestra es equivalente (ver sección 4).

### Cómo circula el dinero en el original (la parte cripto)

```
                 ┌───────────────── Jugador ─────────────────┐
                 │  Wallet (Robinhood Wallet / MetaMask)      │
                 └───────┬───────────────────────┬────────────┘
      1. firma login     │                       │  3. firma y envía la compra
      (gratis)           ▼                       ▼
   ┌──────────────── Servidor (Vercel /api) ─┐   ┌───── Robinhood Chain ─────┐
   │ verifica firma → sesión                  │   │ swap ETH → $POKEGRASS     │
   │ 2. arma la transacción de compra         │   │ y los manda a 0x…dEaD     │
   │ 4. revisa en la cadena que se quemó      │◄──┤ (queda público y auditable)│
   │ 5. entrega el ítem en el juego           │   └───────────────────────────┘
   └──────────────────────────────────────────┘
```

Los tres "motores" económicos:
1. **Gasto (Mart)**: cada ball, radar, huevo… se paga en ETH. Esa compra **compra $POKEGRASS en el mercado y lo quema**. El proyecto nunca guarda el dinero del jugador; todo queda visible en la cadena.
2. **Tenencia (niveles)**: cuanto más $POKEGRASS tengas en tu wallet, más balls diarias y ventajas. El servidor lee tu saldo en la blockchain (`balanceOf`). Hay tres niveles: Ace Trainer (desde 250.000 tokens), Veteran (desde 2,5 M) y Champion (desde 10 M).
3. **Premios semanales**: el pool paga 1 % de cada compra/venta como comisión. El 40 % de esa comisión va a un bote semanal (mínimo $300, máximo $1.500), y los premios se pagan en $POKEGRASS a las wallets ganadoras. Para cobrar hay que tener al menos 250.000 tokens.

**Ojo con esto** (lo dice también el análisis del original): el bote solo existe si hay gente comprando y vendiendo el token. Si baja el volumen, baja el premio.

---

## 3. Qué es Arc (nuestra blockchain)

- Blockchain de **Circle** (la empresa detrás de USDC), compatible con Ethereum: los mismos contratos, wallets y herramientas funcionan ahí.
- Su particularidad: **el gas se paga en USDC**, no en ETH. Para el jugador es más simple: todo en dólares.
- **Mainnet**: chainId **5042**, RPC `https://rpc.mainnet.arc.io`. La verifiqué hoy: responde y va por el bloque ~23 millones.
- **Testnet**: chainId **5042002**, RPC `https://rpc.testnet.arc.io`, explorador `testnet.arcscan.app`, USDC gratis de prueba en `faucet.circle.com`.
- Mainnet salió al público el **16 de septiembre de 2026**. Uniswap (v2, v3 y v4) está en Arc desde el primer día.
- Ya hay tokens nuevos lanzándose en Arc: GeckoTerminal y DexScreener los listan, y de ahí sacamos los monstruos salvajes.

**Detalle técnico importante:** en Arc el USDC tiene dos caras. Como moneda de gas usa 18 decimales, y como token ERC-20 usa 6. Hoy leemos el saldo de gas. Cuando hagamos pagos hay que elegir cuál usar y no mezclar los decimales, porque ahí es donde se cometen errores de "cobré 1 millón de veces más".

---

## 4. Cómo estamos nosotros: comparación pieza por pieza

| Pieza | Original | Nosotros | Estado |
|---|---|---|---|
| Web del juego | Vercel | Vercel (pokegrass-arc.vercel.app) | ✅ igual |
| Servidor del juego | Funciones de Vercel | **Supabase Edge Function** `game` (v5) | ✅ equivalente |
| Base de datos | Privada | **Supabase Postgres** | ✅ |
| Quién decide capturas, combates, balls y puntos | El servidor | El servidor (el navegador no puede hacer trampa) | ✅ igual |
| Login con wallet | Firma de mensaje + verificación en servidor | Firma de mensaje con código de un solo uso, verificada en el servidor | ✅ igual (buena práctica) |
| Red de la wallet | Robinhood Chain | **Arc mainnet** (cambia la red solo) | ✅ |
| Monstruos = tokens reales de la cadena | Tokens de Robinhood Chain | Tokens nuevos y en tendencia de **Arc** (cada minuto) | ✅ conectado y funcionando |
| Misiones, huevos, liga semanal | Sí | Sí | ✅ |
| **Token propio del juego** | $POKEGRASS | **No existe todavía** | ❌ falta tu decisión |
| **Mart con pago real + quema** | ETH → compra y quema $POKEGRASS | Gratis (modo demo) | ❌ depende del token |
| **Niveles por holdear** | Lee `balanceOf` | No | ❌ depende del token |
| **Premios semanales pagados** | En $POKEGRASS a wallets | Solo puntos | ❌ depende del token |
| Intercambios, ver otros jugadores, recuperar cuenta con clave | Sí | No | ⏳ se pueden hacer ya |

### ¿Está bien hecho y de verdad conectado? Lo que revisé

**Bien hecho (buenas prácticas que ya cumplimos):**
- La **clave maestra de Supabase** solo vive en el servidor, nunca en el navegador.
- Las tablas están **cerradas al público** (RLS sin permisos): solo el servidor las toca. El chequeo de seguridad de Supabase solo da un aviso informativo que confirma exactamente eso, y es lo que queremos.
- Las **sesiones** se guardan cifradas (solo su huella SHA-256), así que si alguien robara la base, no podría entrar con ellas.
- El **login con wallet** usa un código de un solo uso que expira en 5 minutos (evita que reusen una firma vieja).
- El **tick** (el proceso que trae los tokens de Arc cada minuto) está protegido con un secreto.
- Anti-trampas: enfriamiento entre lanzamientos, la probabilidad de captura la calcula el servidor, los metros caminados tienen tope de velocidad, y el shiny lo decide un secreto del servidor.

**Cosas a corregir ANTES de pagar dinero real** (hoy no importan porque no hay premios en dinero):
1. **El Mart gratis permite sacar balls infinitas.** Mientras no haya premios en dinero da igual, pero **no se pueden pagar premios con el Mart gratis**, porque cualquiera podría farmear puntos.
2. **Cuentas de invitado ilimitadas.** Alguien podría crear mil cuentas. El original lo resuelve exigiendo wallet y un mínimo de tokens para cobrar premios. Haremos lo mismo.
3. **Las sesiones no caducan.** Conviene ponerles vencimiento (p. ej. 30 días).
4. **Límite de peticiones por jugador** en el servidor. Hoy solo existe en los lanzamientos.

---

## 5. Cómo se monta un proyecto en una blockchain (nuestro plan en Arc)

Paso a paso, en orden. Todo se hace **primero en testnet**.

1. **Crear el token.** Dos caminos:
   - *Launchpad en Arc* (como hizo el original con Pons): en un clic, sin programar. El recomendado es **Pools** (pools.xyz), ver sección 7.
   - *Contrato propio*: se programa un ERC-20 estándar (OpenZeppelin), se despliega con una wallet "deployer" y se verifica en el explorador de Arc (`explorer.arc.io`) para que cualquiera pueda leer su código.
2. **Crear el pool de liquidez** en un DEX de Arc: token + USDC. Ahí nace el precio. Hay que decidir cuánto USDC se pone de liquidez inicial.
3. **Publicar la config** (como el `launch.json` del original): dirección del token, link de compra, wallets de admin, niveles de holder y precios del Mart.
4. **Mart con pago real:** el servidor arma una transacción de "cambia X USDC por token y mándalo a quemar". El jugador la firma con su wallet, y el servidor verifica en la cadena que pasó antes de entregar el ítem. **No custodiamos fondos.**
5. **Niveles:** el servidor lee el saldo del token en la wallet del jugador.
6. **Premios:** una wallet de tesorería paga a los ganadores. Lo recomendable es una **multisig (Safe)**: varias personas tienen que aprobar cada pago, así un solo hackeo no vacía la tesorería. La alternativa es una wallet "caliente" cuya llave vive como secreto en el servidor (más cómodo, más riesgo).
7. Probar todo en testnet → auditar → pasar a mainnet cambiando solo direcciones y chainId.

---

## 6. Lo que necesito que decidas o me pases

| # | Qué | Por qué |
|---|---|---|
| 1 | Nombre y ticker del token (p. ej. $POKEGRASS-ARC) | Para crearlo |
| 2 | ¿Launchpad o contrato propio? | Define el paso 1 |
| 3 | Wallet **deployer** / creadora (tuya, nunca me pases la llave privada: tú firmas) | Crea el token y el pool |
| 4 | Liquidez inicial en USDC | Fija el precio de arranque |
| 5 | Wallet de **tesorería** para premios (ideal: Safe multisig) | Para pagar premios |
| 6 | Presupuesto semanal de premios, o de dónde sale (comisiones, fijo) | Economía de la liga |
| 7 | Niveles de holder (¿dejamos 250 k / 2,5 M / 10 M?) | Depende del supply |
| 8 | Wallets de admin | Panel de pagos |

Con **1, 2 y 3** ya puedo dejar todo el flujo de pago funcionando en **testnet** para que lo pruebes sin gastar un peso.

---

## 7. Cómo publicar TU token y dónde ver todo (las webs)

### Las webs que vas a usar

| Para qué | Web | Notas |
|---|---|---|
| Tu wallet | **MetaMask** o **Rabby** (extensión del navegador) | Soportan Arc. También Phantom, Rainbow, Trust, Ledger |
| Agregar Arc a la wallet | **chainlist.org** (busca "Arc", chainId 5042) o **portal.arc.io** | Un clic y la wallet ya conoce la red |
| Portal oficial de Arc | **portal.arc.io** | Wallet, traer USDC desde otras redes, swaps |
| Ver cualquier cosa en la cadena (mainnet) | **explorer.arc.io** | Pegas una dirección o un hash y ves saldos, transacciones y contratos |
| Ver cosas en testnet | **testnet.arcscan.app** | Lo mismo, pero en la red de práctica |
| USDC gratis de prueba | **faucet.circle.com** | Eliges "Arc Testnet" y pegas tu dirección |
| **Lanzar el token (recomendado)** | **pools.xyz** | Launchpad oficial de Uniswap en Arc |
| Otros launchpads en Arc | pegd.fun, Arguspad, Minara.fun | Más "memecoin". Úsalos solo si sabes por qué |
| Comprar y vender | **app.uniswap.org** (red Arc) | Tu token aparece solo cuando se lanza en Pools |
| Gráficos y precio | **dexscreener.com/arc**, **geckoterminal.com/arc** | De aquí mismo sacamos los monstruos del juego |
| Contrato propio (opcional) | **wizard.openzeppelin.com** + **remix.ethereum.org** | Generas un ERC-20 estándar y lo despliegas desde el navegador |
| Documentación | **docs.arc.io** | Oficial de Circle |

Y para ver **nuestro** juego por dentro:
- **Base de datos y servidor:** supabase.com/dashboard, proyecto `jwthfdfhzenbmtitafze`. Ahí están los entrenadores, las capturas, las sesiones y los logs del servidor.
- **La web:** vercel.com, proyecto `pokegrass-arc`.
- **La wallet de un jugador:** su dirección en explorer.arc.io.

### Paso a paso para lanzar el token

**0. Practica en testnet (gratis).**
1. Instala MetaMask o Rabby, crea una wallet y **anota la frase semilla en papel**. Nadie más debe verla, ni yo.
2. Agrega **Arc Testnet** (chainId 5042002) y pide USDC en faucet.circle.com.
3. Abre testnet.arcscan.app y pega tu dirección: vas a ver los USDC que te llegaron. Esa es la forma de "ver todo".

**1. Consigue USDC real en Arc mainnet.** En mainnet no hay faucet. Compra USDC en un exchange y retíralo **por la red Arc**, o tráelo desde otra red con el puente de Circle en portal.arc.io. Para lanzar basta con poco: el gas cuesta centavos, más la compra inicial que quieras hacer tú como creador.

**2. Lanza en pools.xyz.** Es lo más parecido a lo que hizo el original con Pons: el token queda en un pool de **Uniswap v4 contra USDC** y la liquidez queda **bloqueada para siempre** (nadie la puede retirar, ni tú, y eso da confianza). El supply es fijo: 1.000 millones, igual que el original. Hay dos modos:
   - **Instant Launch:** sale al mercado en el acto (curva de precio clásica).
   - **Crowd Launch:** una ventana de horas donde la gente puja. Si no llega a $10k de valor, se devuelve todo. Da más liquidez inicial.
   - **Activa la "creator fee" al lanzar.** Solo se puede elegir en ese momento. Es tu parte de las comisiones y la que financiaría el bote de premios.

**3. Copia la dirección del contrato (CA)** que te da Pools y pásamela. Con eso conecto el juego: Mart, niveles y premios.

**4. Revisa que todo se vea:** tu token en explorer.arc.io, su gráfico en dexscreener.com/arc, y la compra en app.uniswap.org.

### Ojo con la economía de las comisiones

En el original el pool cobra un **1 %** y el 40 % va a premios, o sea que **0,4 %** de cada compra o venta va al bote. En Pools la comisión es **0,25 %** y la parte del creador es **0,05 %**: por el mismo volumen, **unas 8 veces menos** dinero para el bote. Hay tres salidas:
- **Pools + un bote fijo semanal** que pones tú (p. ej. $100 a $300) al principio. Es lo más simple y lo más confiable. **Recomendado.**
- Un launchpad con comisión más alta, como **pegd.fun** (1 %, la mitad para el creador). Más ingreso, pero es menos conocido.
- Contrato propio + pool propio en Uniswap con la comisión que tú quieras. Es lo más flexible, pero tienes que poner la liquidez tú mismo.

_Los datos de los launchpads salen de sus páginas públicas al 27/09/2026. Confírmalos en la web del launchpad antes de lanzar._

---

## 8. Qué nos falta para salir a producción como MVP (paridad con el original)

Revisado hoy: el servidor responde, el proceso que trae los tokens de Arc corre **cada minuto sin fallos en las últimas 24 h**, y el juego base (explorar, capturar, combatir, misiones, huevos, liga) funciona.

### P0: imprescindible para salir con dinero real

| # | Qué | Depende del token | Qué implica |
|---|---|---|---|
| 1 | **Token lanzado + config pública** | Sí (lo lanzas tú) | El equivalente del `launch.json` del original: dirección, link de compra, niveles y precios. Más una **pantalla del token** en el juego: CA para copiar, botón Comprar, cuánto se ha quemado y link al gráfico |
| 2 | **Mart con pago real + quema** | Sí | El servidor arma el swap USDC → token → `0x…dEaD` con Uniswap en Arc. Tú firmas, y el servidor revisa en la cadena que la quema ocurrió (y que cada transacción se usa una sola vez) antes de entregar el ítem. Se mantienen las balls gratis diarias |
| 3 | **Niveles por holdear** | Sí | El servidor lee `balanceOf` de la wallet (con caché de pocos minutos) y aplica las ventajas de Ace, Veteran y Champion |
| 4 | **Premios semanales + panel de admin** | Sí | Cierre semanal con ganadores, chequeo de elegibilidad (wallet + mínimo de tokens), y un panel donde el admin paga desde la tesorería y registra el hash del pago. Al principio se paga a mano; automatizarlo viene después |
| 5 | **Anti-abuso** | No | ✅ **Hecho (servidor v6):** sesiones que caducan tras 30 días sin uso, máximo 150 peticiones por minuto por sesión, y límites por IP (6 invitados por hora, intentos de login y de recuperación). Queda para los premios: exigir wallet y mínimo de tokens |
| 6 | **Legal mínimo** | No | Términos, privacidad, reglas de los premios y un aviso de "esto no es una inversión". **Consulta a un abogado:** los premios en cripto pueden contar como sorteo o apuesta según el país |

### P1: lo que tiene el original y nosotros aún no (no bloquea salir)

| # | Qué | Qué es |
|---|---|---|
| 7 | Clave de recuperación | ✅ **Hecho:** Menú → "Account & recovery". Crea una clave `PG-XXXXX-…` (solo se guarda su huella) y permite entrar a esa partida desde otro dispositivo |
| 8 | Ver a otros jugadores | Presencia en el mapa: nombre y avatar de quién anda cerca |
| 9 | Intercambios | Cambiar monstruos entre jugadores |
| 10 | Eventos especiales | Monstruo Dorado, Legend Summit (legendarios), premios de arena y de descubridor, invitaciones y referidos |

### P2: operación (antes o justo después de salir)

| # | Qué |
|---|---|
| 11 | **Backups:** el plan gratis de Supabase no incluye copias diarias; el plan Pro (≈ $25/mes) sí. Imprescindible cuando haya dinero en juego |
| 12 | **Alertas de errores** en el navegador y el servidor, y un monitor que avise si la web se cae |
| 13 | Dominio propio (en vez de `.vercel.app`) |
| 14 | Prueba completa en móvil (controles táctiles y rendimiento) |
| 15 | ✅ **Hecho:** las misiones "atrapa N del tipo X" solo eligen tipos con al menos 2 especies comunes (Normal, Bug, Grass, Water, Fighting, Rock, Ice) |

### El orden que propongo

1. **Ya, sin token:** 5 (anti-abuso), 7 (recuperación) y 15 (balance) ✅ hechos. Falta el borrador de 6 (legal).
2. **En testnet, con un token de prueba que despliego yo desde una wallet desechable (sin valor real, nunca con la tuya):** 1, 2, 3 y 4 funcionando de punta a punta, para que pruebes comprar, quemar y cobrar sin dinero real.
3. **Día de lanzamiento:** lanzas en pools.xyz, me pasas el CA, cambio la dirección y la red, y queda en mainnet.
4. **Después:** 8, 9 y 10 (lo social y los eventos) y 11 a 14 (operación).

---

## Glosario rápido

- **CA**: dirección del contrato del token.
- **Gas**: comisión por escribir en la blockchain (en Arc se paga en USDC).
- **RPC**: la "puerta" por la que una app habla con la blockchain.
- **Explorer**: web para ver cualquier transacción o saldo (Arc: explorer.arc.io; testnet: testnet.arcscan.app).
- **Launchpad**: web que crea el token y su pool en un clic (Arc: pools.xyz).
- **Creator fee**: la parte de las comisiones de compra y venta que se lleva quien creó el token.
- **Firma**: prueba de que eres dueño de una wallet, sin mover dinero.
- **Burn / quemar**: sacar tokens de circulación para siempre.
- **Pool / liquidez**: el depósito que permite comprar y vender un token.
- **Multisig (Safe)**: wallet que necesita varias aprobaciones para mover fondos.
- **Supabase**: nuestro servidor y base de datos (reemplaza lo que el original tiene en Vercel).
- **Edge Function**: el programa del servidor del juego que vive en Supabase.
