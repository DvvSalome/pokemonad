// El servidor de PokeGrass Arc Edition. Una sola función con acciones (POST {action, ...}); la sesión va en
// la cabecera `x-session` (token aleatorio; en la base solo su sha256). Es la única autoridad del juego:
// qué salvajes hay, si una bola atrapa, cuánto daño hace un ataque, cuántas bolas te quedan y los puntos.
// La base (RLS sin políticas) solo se toca desde aquí con la clave de servicio.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createPublicClient, formatUnits, http, parseUnits, verifyMessage } from 'npm:viem@2';
import {
  BALL_KEYS, CATALOG, FLEE_CHANCE, LEAGUE_POINTS, WILD_LEVEL, catchChance, catchRate, cleanText, damageOf,
  faintedOf, fighter, hash32, levelOf, lineOf, mix32, modelOf, movesFor, rarityOf, speciesById, speciesName,
  stageOf, wildLevelOf, type BallKey, type Stats, type Tier,
} from './pokemath.ts';
import {
  EGG, EGG_BAG_MAX, EGG_EVERY_CATCHES, INCUBATORS, MAX_WALK_SPEED, MISSION_REWARD, bump, catchEvents, eggView, giveEgg,
  hatchLine, rollMissions, type Egg, type EggKind, type Missions, type Progress,
} from './quests.ts';
import { makeFeatures } from './features.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-session, x-tick-secret, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...headers } });
class Fail extends Error {
  constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); }
}

// ---------- reglas ----------
/** Los salvajes cambian cada 90 s, como las ventanas `w` del original. */
const WINDOW_MS = 90_000;
const SPAWNS_PER_WINDOW = 30;
/** Un token solo se puede encontrar si está entre los N más nuevos o en tendencia (no cualquier dirección). */
const ENCOUNTERABLE_MAX = 200;
/**
 * De esos N, cuántos se reservan a los de lanzamiento más reciente. Sin esta reserva el corte se hacía solo
 * por capitalización, y un token recién salido —que empieza con unos pocos miles de FDV— nunca entraba:
 * la promesa de "cada token nuevo de Arc aparece en la región" no se cumplía para los realmente nuevos.
 */
const ENCOUNTERABLE_NEW = 60;
const START_BALLS: Record<BallKey, number> = { ball: 5, super: 2, hyper: 0, hood: 1 };
const SHINY_ODDS = 1 / 128;
const DISCOVER_BONUS = 50;
const MIN_PLAYER_LEVEL = WILD_LEVEL + 3;
const THROW_COOLDOWN_MS = 1200;
/** Una sesión sin usar durante 30 días caduca (cada uso la renueva). */
const SESSION_IDLE_MS = 30 * 864e5;
/** Topes [peticiones, ventana en s]. El cliente normal hace ~10/min; un combate rápido, unas 40. */
const SESSION_RATE: [number, number] = [150, 60];
const IP_RATE: Record<string, [number, number]> = {
  nonce: [30, 600], wallet: [30, 600], recover: [10, 3600], board: [60, 60], mart: [60, 60], token: [60, 60],
  referral: [10, 3600], 'trade-offer': [30, 600], 'trainer-find': [30, 60], discovered: [60, 60],
  'market-list': [30, 600], 'market-quote': [30, 600], 'market-buy': [30, 600], 'arena-start': [40, 600], 'gym-start': [40, 600],
};
const WEEK0 = Date.UTC(2026, 0, 5); // un lunes
const weekOf = (t: number) => Math.floor((t - WEEK0) / (7 * 864e5));
const today = () => new Date().toISOString().slice(0, 10);

const MART: Record<string, { balls?: Partial<Record<BallKey, number>>; buff?: string; minutes?: number; spawns?: { n: number; tiers: Tier[] }; egg?: EggKind }> = {
  grass10: { balls: { ball: 10 } },
  super10: { balls: { super: 10 } },
  hyper5: { balls: { hyper: 5 } },
  hood: { balls: { hood: 1 } },
  radar: { buff: 'radar', minutes: 30 },
  lure: { minutes: 10, spawns: { n: 2, tiers: ['Rare'] } },
  charm: { buff: 'charm', minutes: 60 },
  revive: { buff: 'revive', minutes: 1440 },
  egg: { egg: 'blue' },
  goldegg: { egg: 'gold' },
  safari: { balls: { super: 10 }, minutes: 5, spawns: { n: 6, tiers: ['Rare', 'Epic'] } },
  summit: { buff: 'summit', minutes: 1440 },
};

// ---------- pago de la Mart (ERC-20) ----------
// Todo es configuración (secrets de la función): cambiar de USDC en Arc testnet a BAGFI en mainnet es
// PAY_CHAIN_ID=5042, PAY_RPC_URL=https://rpc.mainnet.arc.io, PAY_TOKEN=0x1f9f…241e, PAY_DECIMALS=18,
// PAY_SYMBOL=BAGFI, PAY_EXPLORER=https://arcscan.app y TREASURY_ADDRESS=<wallet que cobra>.
// En Arc el USDC nativo (gas, 18 decimales) también es un ERC-20 en 0x3600…0000 con 6 decimales: se cobra por ahí.
const envOr = (k: string, d: string) => Deno.env.get(k)?.trim() || d;
const envInt = (k: string, d: number) => { const n = Math.floor(Number(envOr(k, String(d)))); return n > 0 ? n : d; };
/** Cuentas de invitado nuevas por IP: holgado para redes compartidas (colegios, cafés), con tope diario aparte. */
const GUEST_RATE: [string, number, number][] = [
  ['guest', envInt('GUEST_PER_IP_HOUR', 30), 3600],
  ['guestd', envInt('GUEST_PER_IP_DAY', 150), 86400],
];
const PAY = {
  chainId: Number(envOr('PAY_CHAIN_ID', '5042002')),
  chainName: envOr('PAY_CHAIN_NAME', 'Arc Testnet'),
  rpc: envOr('PAY_RPC_URL', 'https://rpc.testnet.arc.network'),
  explorer: envOr('PAY_EXPLORER', 'https://testnet.arcscan.app'),
  token: envOr('PAY_TOKEN', '0x3600000000000000000000000000000000000000').toLowerCase(),
  decimals: Number(envOr('PAY_DECIMALS', '6')),
  symbol: envOr('PAY_SYMBOL', 'USDC'),
  // Por defecto, una dirección de prueba sin dueño (20 bytes al azar): lo que llegue ahí no se recupera.
  treasury: envOr('TREASURY_ADDRESS', '0xafd6153d77380859439ab76f313d244341b6f18f').toLowerCase(),
};
/** Precios en unidades del token (no en dólares). PAY_PRICES='{"grass10":"0.05",…}' los sobrescribe. */
const PRICES: Record<string, string> = {
  grass10: '0.05', super10: '0.10', hyper5: '0.25', hood: '0.25', radar: '0.10', lure: '0.10',
  charm: '0.25', revive: '0.10', safari: '0.50', egg: '0.25', goldegg: '0.50', summit: '0.50',
  ...(() => { try { return JSON.parse(Deno.env.get('PAY_PRICES') ?? '{}'); } catch { return {}; } })(),
};
/** Un pago solo vale durante este tiempo desde que entró en un bloque. */
const PAY_MAX_AGE_S = 24 * 3600;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function isAddr(a: string) { return /^0x[0-9a-f]{40}$/.test(a); }
const payChain = createPublicClient({ transport: http(PAY.rpc, { timeout: 8_000, retryCount: 1 }) });
const MAINNET = PAY.chainId === 5042;
const jsonEnv = <T,>(k: string, d: T): T => { try { return { ...d, ...JSON.parse(Deno.env.get(k) ?? '{}') }; } catch { return d; } };

// ---------- token del juego (lo que se holdea, se quema en la Mart y paga los premios) ----------
// Es el mismo token de PAY_*; estos secrets solo añaden lo que muestra la pantalla "Token".
const DEAD = '0x000000000000000000000000000000000000dead';
/** 'treasury' (testnet): el pago va a TREASURY_ADDRESS. 'burn' (mainnet): el token del pago tiene que acabar en 0x…dEaD. */
const MART_MODE = envOr('MART_MODE', 'treasury') === 'burn' ? 'burn' : 'treasury';
const TOKEN = {
  name: envOr('TOKEN_NAME', MAINNET ? PAY.symbol : 'USD Coin (Arc Testnet)'),
  buyUrl: envOr('TOKEN_BUY_URL', MAINNET ? `https://app.uniswap.org/swap?chain=arc&outputCurrency=${PAY.token}` : 'https://faucet.circle.com/'),
  chartUrl: envOr('TOKEN_CHART_URL', MAINNET ? `https://dexscreener.com/arc/${PAY.token}` : `${PAY.explorer}/token/${PAY.token}`),
  tokenUrl: `${PAY.explorer}/token/${PAY.token}`,
};
/**
 * Niveles por holdear (tokens enteros). Mainnet: los del original (250 k / 2,5 M / 10 M). En testnet, a escala del
 * faucet de USDC. HOLD_TIERS='{"Ace":"250000","Veteran":"2500000","Champion":"10000000"}' los sobrescribe.
 */
const HOLD_TIERS = jsonEnv<Record<string, string>>('HOLD_TIERS', MAINNET
  ? { Ace: '250000', Veteran: '2500000', Champion: '10000000' } : { Ace: '1', Veteran: '5', Champion: '20' });
const TIER_ORDER = ['Ace', 'Veteran', 'Champion'] as const;
type HoldTier = typeof TIER_ORDER[number];
/** Ventajas: más bolas en el regalo diario y, el Champion, shiny ×1,5. */
const TIER_PERKS: Record<HoldTier, { daily: Partial<Record<BallKey, number>>; shiny: number; text: string }> = {
  Ace: { daily: { ball: 5, super: 1 }, shiny: 1, text: '+5 Grass & 1 Super every day' },
  Veteran: { daily: { ball: 10, super: 3, hyper: 1 }, shiny: 1, text: '+10 Grass, 3 Super & 1 Hyper every day' },
  Champion: { daily: { ball: 20, super: 5, hyper: 2 }, shiny: 1.5, text: '+20 Grass, 5 Super & 2 Hyper every day, shiny odds ×1.5' },
};
const HOLD_TTL_MS = 5 * 60_000;
const ERC20_BALANCE = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
const balanceOf = (a: string) => payChain.readContract({ address: PAY.token as `0x${string}`, abi: ERC20_BALANCE, functionName: 'balanceOf', args: [a as `0x${string}`] });

/** Premios semanales en tokens por puesto. PRIZES='{"league":["100","50","25"],…}'. */
type PrizeCat = 'league' | 'arena' | 'discoverer' | 'catch';
const PRIZES = jsonEnv<Record<PrizeCat, string[]>>('PRIZES', MAINNET
  ? { league: ['1000000', '500000', '250000'], arena: ['250000'], discoverer: ['250000'], catch: ['250000'] }
  : { league: ['1', '0.5', '0.25'], arena: ['0.25'], discoverer: ['0.25'], catch: ['0.25'] });
/** Para cobrar hace falta wallet vinculada y al menos esto en ella (tokens enteros). */
const PRIZE_MIN_HOLD = envOr('PRIZE_MIN_HOLD', HOLD_TIERS.Ace ?? '0');
const ADMIN_WALLETS = envOr('ADMIN_WALLETS', '').toLowerCase().split(/[\s,]+/).filter(isAddr);

// ---------- utilidades ----------
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Cuenta un golpe contra el tope de `key`. Si la base falla, deja pasar (mejor que tumbar el juego). */
async function allowed(key: string, lim: number, winS: number): Promise<boolean> {
  const { data, error } = await db.rpc('rate_hit', { k: key, lim, win_s: winS });
  return error ? true : data === true;
}
/** Segundos hasta que abre la siguiente ventana fija de `rate_hit` (alineadas a la época Unix). */
const retryAfter = (winS: number) => winS - (Math.floor(Date.now() / 1000) % winS);
/** IP del cliente según el proxy de Supabase; la primera de x-forwarded-for es la del cliente. */
const ipOf = (req: Request) =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

type Trainer = {
  id: string; name: string; wallet: string | null; balls: Record<BallKey, number>; buffs: Record<string, number>;
  daily: Record<string, string>; extra: Extra[]; stats: Record<string, number>; score: number; week_id: number;
  week_points: number; imported: boolean; last_throw: string | null;
  missions: Partial<Missions>; eggs: Egg[]; walked: number; walk_at: string | null; recovery_hash: string | null;
  hold_bal: string | null; hold_at: string | null; ref_code: string | null; referred_by: string | null; ref_paid: boolean;
  created_at: string; team?: string[]; badges?: number[]; elo?: number;
};
type Extra = { id: string; line: string; expiresAt: number; kind: string };

// ---------- niveles por holdear ----------
function holdTier(raw: string | null): HoldTier | null {
  if (raw == null) return null;
  const bal = BigInt(String(raw).split('.')[0]);
  let got: HoldTier | null = null;
  for (const k of TIER_ORDER) if (HOLD_TIERS[k] && bal >= parseUnits(HOLD_TIERS[k], PAY.decimals)) got = k;
  return got;
}
/** Relee el saldo de la wallet si la caché tiene más de 5 min (si la red falla, se queda el último). */
async function refreshHold(t: Trainer, force = false) {
  if (!t.wallet || !isAddr(PAY.token)) return;
  if (!force && t.hold_at && Date.now() - Date.parse(t.hold_at) < HOLD_TTL_MS) return;
  const bal = await balanceOf(t.wallet).catch(() => null);
  if (bal === null) return;
  const patch = { hold_bal: bal.toString(), hold_at: new Date().toISOString() };
  Object.assign(t, patch);
  await db.from('trainers').update(patch).eq('id', t.id);
}
function holderView(t: Trainer) {
  const tier = t.wallet ? holdTier(t.hold_bal) : null;
  const next = TIER_ORDER.find((k) => HOLD_TIERS[k] && (!tier || TIER_ORDER.indexOf(k) > TIER_ORDER.indexOf(tier)));
  return {
    tier, perks: tier ? TIER_PERKS[tier].text : null, symbol: PAY.symbol,
    balance: t.wallet && t.hold_bal != null ? formatUnits(BigInt(String(t.hold_bal).split('.')[0]), PAY.decimals) : null,
    checkedAt: t.hold_at ? Date.parse(t.hold_at) : null, next: next ? { tier: next, min: HOLD_TIERS[next] } : null,
  };
}
const tierConfig = () => TIER_ORDER.filter((k) => HOLD_TIERS[k]).map((k) => ({ tier: k, min: HOLD_TIERS[k], perks: TIER_PERKS[k].text }));

/** Misiones del día y de la semana en curso (se renuevan solas). */
const missionsOf = (t: Trainer) => rollMissions(t.missions, t.id, today(), weekOf(Date.now()));
const progressed = (t: Trainer, evs: Progress[]) => bump(missionsOf(t), evs);

const buffOn = (t: Trainer, k: string) => (t.buffs?.[k] ?? 0) > Date.now();
/** Shiny decidido por el servidor: hash secreto de (entrenador, ejemplar). El Charm amplía el umbral ×4. */
function isShiny(t: Trainer, spawnId: string): boolean {
  const tier = t.wallet ? holdTier(t.hold_bal) : null;
  const odds = SHINY_ODDS * (buffOn(t, 'charm') ? 4 : 1) * (tier ? TIER_PERKS[tier].shiny : 1);
  return mix32(hash32(`${SERVICE_KEY.slice(-24)}|${t.id}|${spawnId}`)) / 4294967296 < odds;
}

async function newSession(trainerId: string): Promise<string> {
  const token = randomHex(32);
  const { error } = await db.from('sessions').insert({ token_hash: await sha256(token), trainer_id: trainerId });
  if (error) throw new Fail(error.message, 500);
  return token;
}

async function trainerFromSession(req: Request): Promise<Trainer> {
  const token = req.headers.get('x-session');
  if (!token) throw new Fail('no session', 401);
  const hash = await sha256(token);
  const [{ data: s, error: sErr }, fast] = await Promise.all([
    db.from('sessions').select('trainer_id, seen_at').eq('token_hash', hash).maybeSingle(),
    allowed(`s:${hash}`, ...SESSION_RATE),
  ]);
  // Un fallo de la consulta no es una sesión inválida. Mirar solo `!s` convertía cualquier problema de
  // esquema en un 401 "bad session", que es lo que dejó el juego entero sin conexión sin pista de por qué.
  if (sErr) throw new Fail(sErr.message, 500);
  if (!s) throw new Fail('bad session', 401);
  const idle = Date.now() - Date.parse(s.seen_at);
  if (idle > SESSION_IDLE_MS) {
    await db.from('sessions').delete().eq('token_hash', hash);
    throw new Fail('session expired', 401);
  }
  if (!fast) throw new Fail('slow down a little', 429);
  if (idle > 3600_000) await db.from('sessions').update({ seen_at: new Date().toISOString() }).eq('token_hash', hash);
  const { data: t } = await db.from('trainers').select('*').eq('id', s.trainer_id).single();
  if (!t) throw new Fail('no trainer', 401);
  return t as Trainer;
}

async function saveTrainer(t: Trainer, patch: Partial<Trainer>) {
  Object.assign(t, patch);
  const { error } = await db.from('trainers').update({ ...patch, seen_at: new Date().toISOString() }).eq('id', t.id);
  if (error) throw new Fail(error.message, 500);
}

/** Lo de la semana en `week_scores` (de ahí salen los premios): puntos, victorias de arena y descubrimientos. */
async function weekAdd(t: Trainer, pts: number, wins = 0, disc = 0) {
  if (!pts && !wins && !disc) return;
  await db.rpc('week_add', { tid: t.id, wk: weekOf(Date.now()), pts, w: wins, d: disc });
}

/** Suma puntos de liga (totales y de la semana, que se reinicia al cambiar de semana). */
function withPoints(t: Trainer, pts: number): Partial<Trainer> {
  const w = weekOf(Date.now());
  const week_points = (t.week_id === w ? t.week_points : 0) + pts;
  return { score: t.score + pts, week_id: w, week_points };
}

/** Regalo diario: 10 Grass para todos, +15 Grass y 2 Super con wallet (como el original). */
async function claimDaily(t: Trainer): Promise<string[]> {
  const d = { ...(t.daily ?? {}) }, day = today(), balls = { ...t.balls }, got: string[] = [];
  if (d.base !== day) { balls.ball += 10; d.base = day; got.push('10 Grass Balls'); }
  if (t.wallet && d.wallet !== day) { balls.ball += 15; balls.super += 2; d.wallet = day; got.push('+15 Grass & 2 Super for your wallet'); }
  const tier = t.wallet ? holdTier(t.hold_bal) : null;
  if (tier && d.tier !== day) {
    for (const k of BALL_KEYS) balls[k] += TIER_PERKS[tier].daily[k] ?? 0;
    d.tier = day; got.push(`${tier} holder bonus: ${TIER_PERKS[tier].text.replace(' every day', '')}`);
  }
  if (got.length) await saveTrainer(t, { balls, daily: d });
  return got;
}

// ---------- vistas ----------
async function boxOf(trainerId: string) {
  const { data } = await db.from('box')
    .select('spawn_id, species_id, name, tier, model, stage, shiny, m0, discovered, caught_at, token, tokens(symbol, name, logo, mcap, liquidity, launched_at, dex_no)')
    .eq('trainer_id', trainerId).order('caught_at', { ascending: true });
  return (data ?? []).map((b: any) => ({
    id: b.spawn_id, speciesId: b.species_id, name: b.name, tier: b.tier, model: b.model, stage: b.stage,
    shiny: b.shiny, caughtAt: Date.parse(b.caught_at), discovered: b.discovered,
    token: b.token && b.tokens ? {
      address: b.token, symbol: b.tokens.symbol, name: b.tokens.name, logo: b.tokens.logo ?? undefined,
      marketCap: b.tokens.mcap, liquidityUsd: b.tokens.liquidity, createdAt: Date.parse(b.tokens.launched_at),
      m0: b.m0 ?? b.tokens.mcap, dexNo: b.tokens.dex_no,
    } : undefined,
  }));
}

function publicTrainer(t: Trainer) {
  const w = weekOf(Date.now());
  return {
    id: t.id, name: t.name, wallet: t.wallet, balls: t.balls, buffs: F.buffsView(t), stats: t.stats, score: t.score,
    team: t.team ?? [], badges: t.badges ?? [], elo: t.elo ?? 1000,
    weekPoints: t.week_id === w ? t.week_points : 0, imported: t.imported, hasRecovery: !!t.recovery_hash,
    eggsReady: (t.eggs ?? []).filter((e) => eggView(e, t.walked ?? 0).progress >= 1).length,
    missionsReady: (() => { const m = missionsOf(t); return [...m.d, ...m.w].filter((x) => x.p >= x.goal && !x.claimed).length; })(),
    extra: [...(t.extra ?? []).filter((e) => e.expiresAt > Date.now()), ...F.legendExtra(t)].map((e) => ({ ...e, shiny: isShiny(t, e.id) })),
    holder: holderView(t), refCode: t.ref_code, referred: !!t.referred_by, refs: t.stats?.refs ?? 0,
  };
}

async function me(t: Trainer) {
  await Promise.all([refreshHold(t), ensureRefCode(t)]);
  const daily = await claimDaily(t);
  return { trainer: { ...publicTrainer(t), admin: await isAdmin(t) }, box: await boxOf(t.id), daily };
}

/**
 * Los tokens que se pueden encontrar ahora: los que DexScreener devolvió hace poco, con liquidez.
 * Se juntan dos listas porque ordenar solo por capitalización dejaba fuera justo a los recién lanzados
 * (empiezan con FDV de miles, nunca llegan al corte): los grandes, que son los que la gente busca, y los
 * más nuevos, que son los que hacen que la región refleje lo que acaba de salir en Arc.
 */
async function encounterable() {
  const freshSince = new Date(Date.now() - DS_FRESH_MS).toISOString();
  const base = () => db.from('tokens').select('*').gte('ds_seen_at', freshSince).gte('liquidity', MIN_LIQ);
  const [big, recent] = await Promise.all([
    base().order('mcap', { ascending: false }).limit(ENCOUNTERABLE_MAX - ENCOUNTERABLE_NEW),
    base().order('launched_at', { ascending: false }).limit(ENCOUNTERABLE_NEW),
  ]);
  // Ignorar `.error` hacía que un problema de consulta —una columna que falta, por ejemplo— se viera igual
  // que "no hay nada en la hierba": la región salía vacía y ni el servidor ni el cliente podían decir por
  // qué. Mismo caso que `trainerFromSession`: un fallo de la consulta no es un resultado vacío.
  const err = big.error ?? recent.error;
  if (err) throw new Fail(err.message, 500);
  const map = new Map<string, any>([...(big.data ?? []), ...(recent.data ?? [])].map((x: any) => [x.address, x]));
  return { all: [...map.values()], map };
}

/** Cuánto aparece cada rareza (peso del sorteo por ventana): los grandes salen, pero menos. */
const SPAWN_WEIGHT: Record<Tier, number> = { Common: 1, Uncommon: 0.85, Rare: 0.65, Epic: 0.45, Legendary: 0.3 };

async function route(t: Trainer) {
  const now = Date.now(), w = Math.floor(now / WINDOW_MS);
  const refill = summitRefill(t);
  if (refill) await saveTrainer(t, refill);
  const [{ all }, events] = await Promise.all([encounterable(), activeEvents()]);
  const { data: owned } = await db.from('box').select('token').eq('trainer_id', t.id).not('token', 'is', null);
  const mine = new Set((owned ?? []).map((o: any) => o.token));
  // Sorteo ponderado y determinista por ventana (Efraimidis–Spirakis): clave = -ln(u)/peso, se quedan las menores.
  const key = (x: any) => -Math.log((hash32(`${w}|${x.address}`) + 1) / 4294967297) / SPAWN_WEIGHT[rarityOf(x.mcap)];
  const spawns = all.filter((x: any) => !mine.has(x.address))
    .map((x: any) => ({ x, k: key(x) })).sort((a: any, b: any) => a.k - b.k).slice(0, SPAWNS_PER_WINDOW)
    .map(({ x }: any) => ({
      address: x.address, symbol: x.symbol, name: x.name, logo: x.logo ?? undefined, marketCap: x.mcap,
      liquidityUsd: x.liquidity, createdAt: Date.parse(x.launched_at), kind: x.hot ? 'hot' : 'new', dexNo: x.dex_no,
      catches: x.catches, shiny: isShiny(t, `t-${x.address}`), tier: rarityOf(x.mcap), level: wildLevelOf(x.mcap),
    }));
  return { w, endsAt: (w + 1) * WINDOW_MS, now, spawns, events, extra: publicTrainer(t).extra };
}

// ---------- eventos: Monstruo Dorado y Legend Summit ----------
const GOLD_POINTS = 300;
const GOLD_MINUTES = 15;
/** Probabilidad por minuto de que empiece un Monstruo Dorado (≈ uno cada 3 h), si no hay otro en las últimas 2 h. */
const GOLD_CHANCE = Number(envOr('GOLD_CHANCE', String(1 / 180)));
const GOLD_GAP_MS = 2 * 3600_000;
/** Los legendarios del Summit son las líneas Epic con nivel y rareza de leyenda (mcap sintético). */
const SUMMIT_MCAP = 6_000_000;
const SUMMIT_AT_ONCE = 3, SUMMIT_TOTAL = 6;
/** Cuántos "lugares" del mapa (terrain PLACES en el cliente) puede elegir el Dorado. */
const GOLD_SPOTS = 7;

function encTier(enc: { token: string | null; mcap: number; line: string; spawn_id: string }): Tier {
  if (enc.token) return rarityOf(enc.mcap, enc.line);
  if (enc.spawn_id.startsWith('summit-') || enc.spawn_id.startsWith('legend-')) return 'Legendary';
  return speciesById(enc.line).tier;
}

async function startGolden(by = 'auto') {
  const pool = CATALOG.filter((s) => s.tier === 'Rare' || s.tier === 'Epic');
  const now = Date.now();
  const ev = {
    id: `gold-${now}`, kind: 'golden', line: pool[Math.floor(Math.random() * pool.length)].id,
    x: Math.floor(Math.random() * GOLD_SPOTS), z: Math.random(), ends_at: new Date(now + GOLD_MINUTES * 60_000).toISOString(),
  };
  const { error } = await db.from('events').insert(ev);
  if (error) throw new Fail(error.message, 500);
  console.log('golden event', ev.id, by);
  return ev;
}
async function maybeGolden() {
  const { data: last } = await db.from('events').select('ends_at').eq('kind', 'golden').order('ends_at', { ascending: false }).limit(1).maybeSingle();
  if (last && Date.parse(last.ends_at) > Date.now() - GOLD_GAP_MS) return;
  if (Math.random() < GOLD_CHANCE) await startGolden();
}
async function activeEvents() {
  const { data } = await db.from('events').select('*').gt('ends_at', new Date().toISOString()).order('ends_at').limit(5);
  return (data ?? []).map((e: any) => ({
    id: e.id, kind: e.kind, line: e.line, spot: Math.round(e.x), jitter: e.z, endsAt: Date.parse(e.ends_at), caughtBy: e.caught_name,
  }));
}

/** Legend Summit: mientras dure el pase hay hasta 3 legendarios en la cumbre (6 en total por pase). */
function summitRefill(t: Trainer): Partial<Trainer> | null {
  if (!buffOn(t, 'summit')) return null;
  const now = Date.now();
  const extra = (t.extra ?? []).filter((e) => e.expiresAt > now);
  const alive = extra.filter((e) => e.kind === 'summit').length;
  let left = t.buffs.summitLeft ?? 0;
  if (alive >= SUMMIT_AT_ONCE || left <= 0) return null;
  const pool = CATALOG.filter((s) => s.tier === 'Epic');
  for (let i = alive; i < SUMMIT_AT_ONCE && left > 0; i++, left--) {
    extra.push({ id: `summit-${now}-${i}`, line: pool[Math.floor(Math.random() * pool.length)].id, expiresAt: t.buffs.summit, kind: 'summit' });
  }
  return { extra, buffs: { ...t.buffs, summitLeft: left } };
}

// ---------- encuentro, captura y combate ----------
async function startEncounter(t: Trainer, spawnId: string) {
  let line: string, token: string | null = null, mcap = 0;
  if (spawnId.startsWith('gold-')) {
    const { data: ev } = await db.from('events').select('*').eq('id', spawnId).maybeSingle();
    if (!ev || Date.parse(ev.ends_at) < Date.now()) throw new Fail('the Golden Monster is gone');
    if (ev.caught_by) throw new Fail(`${ev.caught_name ?? 'someone'} already caught it`);
    line = ev.line;
  } else if (spawnId.startsWith('legend-')) {
    line = F.legendCheck(t, spawnId).line;
    mcap = SUMMIT_MCAP;
  } else if (spawnId.startsWith('t-')) {
    const address = spawnId.slice(2).toLowerCase();
    const { map } = await encounterable();
    const x = map.get(address);
    if (!x) throw new Fail('that monster is not in the grass right now');
    const { data: has } = await db.from('box').select('id').eq('trainer_id', t.id).eq('token', address).maybeSingle();
    if (has) throw new Fail('already caught');
    line = x.line; token = address; mcap = x.mcap;
  } else {
    const e = (t.extra ?? []).find((q) => q.id === spawnId && q.expiresAt > Date.now());
    if (!e) throw new Fail('that monster is gone');
    line = e.line;
    if (e.kind === 'summit') mcap = SUMMIT_MCAP;
  }
  const foeMax = fighter(line, wildLevelOf(mcap)).maxHp;
  const shiny = spawnId.startsWith('gold-') || isShiny(t, spawnId);
  const { error } = await db.from('encounters').upsert({
    trainer_id: t.id, spawn_id: spawnId, token, line, mcap, shiny, foe_hp: foeMax, foe_max: foeMax, battle: null,
    started_at: new Date().toISOString(),
  });
  if (error) throw new Fail(error.message, 500);
  return { spawnId, foeHp: foeMax, foeMax, shiny, base: catchRate(token ? mcap : null, line), foeLevel: wildLevelOf(mcap) };
}

async function getEncounter(t: Trainer) {
  const { data } = await db.from('encounters').select('*').eq('trainer_id', t.id).maybeSingle();
  if (!data) throw new Fail('no encounter');
  return data as any;
}

async function throwBall(t: Trainer, ball: BallKey, quality: number) {
  if (!BALL_KEYS.includes(ball)) throw new Fail('bad ball');
  const enc = await getEncounter(t);
  if ((t.balls?.[ball] ?? 0) <= 0) throw new Fail('no balls of that kind');
  // Anti-ráfaga: la bola solo se descuenta si pasó el enfriamiento (condición atómica en la propia fila).
  const cutoff = new Date(Date.now() - THROW_COOLDOWN_MS).toISOString();
  const balls = { ...t.balls, [ball]: t.balls[ball] - 1 };
  const stats = { ...t.stats, throws: (t.stats?.throws ?? 0) + 1 };
  const missions = progressed(t, [{ k: 'throw', n: 1 }]);
  const { data: ok, error: throwErr } = await db.from('trainers').update({ balls, stats, missions, last_throw: new Date().toISOString() })
    .eq('id', t.id).or(`last_throw.is.null,last_throw.lt.${cutoff}`).select('id');
  // Sin esta comprobación cualquier fallo del update (una columna que falta, por ejemplo) se disfrazaba de
  // "too fast": el tiro no descontaba bola y el jugador veía un 429 que no tenía nada que ver con ráfagas.
  if (throwErr) throw new Fail(throwErr.message, 500);
  if (!ok?.length) throw new Fail('too fast', 429);
  Object.assign(t, { balls, stats, missions });

  const weaken = 1 + 0.7 * (1 - enc.foe_hp / Math.max(1, enc.foe_max));
  const base = Math.min(0.985, catchRate(enc.token ? enc.mcap : null, enc.line) * weaken);
  const chance = catchChance(base, ball, Number(quality) || 1);
  const caught = Math.random() < chance;
  const shakes = caught ? 3 : chance > 0.6 ? 2 : chance > 0.33 ? 1 : 0;

  if (!caught) {
    const fled = Math.random() < FLEE_CHANCE[encTier(enc)];
    if (fled) await db.from('encounters').delete().eq('trainer_id', t.id);
    return { caught: false, shakes, fled, chance, balls: t.balls };
  }

  const stage = enc.token ? stageOf(enc.mcap) : 1;
  const tier: Tier = encTier(enc);
  // Monstruo Dorado: uno para todo el servidor; solo el primero que lo atrapa se lo queda.
  const golden = String(enc.spawn_id).startsWith('gold-');
  if (golden) {
    const { data: won } = await db.from('events').update({ caught_by: t.id, caught_name: t.name })
      .eq('id', enc.spawn_id).is('caught_by', null).select('id');
    if (!won?.length) {
      await db.from('encounters').delete().eq('trainer_id', t.id);
      throw new Fail('someone caught the Golden Monster first!', 409);
    }
  }
  let discovered = false, tok: any = null;
  if (enc.token) {
    const { data } = await db.from('tokens').select('*').eq('address', enc.token).single();
    tok = data;
    const patch: Record<string, unknown> = { catches: (tok.catches ?? 0) + 1, shinies: (tok.shinies ?? 0) + (enc.shiny ? 1 : 0) };
    if (tok.dex_no == null) {
      const { data: n } = await db.rpc('next_dex_no');
      // solo el primero se queda el número (la condición evita que dos capturas simultáneas lo pisen)
      const { data: won } = await db.from('tokens').update({ dex_no: n, first_trainer: t.id }).eq('address', enc.token).is('dex_no', null).select('dex_no');
      if (won?.length) { discovered = true; tok.dex_no = n; }
    }
    await db.from('tokens').update(patch).eq('address', enc.token);
  }
  // El nombre que se muestra ES el del token (su símbolo, o el nombre si no hay símbolo). Solo los
  // salvajes sin token (huevos, Lure) conservan el nombre inventado del bestiario.
  const monName = enc.token && tok ? (tok.symbol || tok.name || speciesName(enc.line, stage))
    : `${golden ? 'Golden ' : ''}${speciesName(enc.line, stage)}`.slice(0, 32);
  const mon = {
    trainer_id: t.id, spawn_id: enc.spawn_id, token: enc.token, species_id: enc.line,
    name: monName, tier, model: modelOf(enc.line, stage), stage, shiny: enc.shiny,
    m0: enc.token ? enc.mcap : null, discovered,
  };
  const { error } = await db.from('box').insert(mon);
  if (error && !/duplicate/i.test(error.message)) throw new Fail(error.message, 500);
  await db.from('encounters').delete().eq('trainer_id', t.id);

  const points = F.boostPts(t, LEAGUE_POINTS[tier] * (enc.shiny ? 2 : 1) + (discovered ? DISCOVER_BONUS : 0) + (golden ? GOLD_POINTS : 0), true);
  const catches = (t.stats?.catches ?? 0) + 1;
  const egg = catches % EGG_EVERY_CATCHES === 0 ? giveEgg(t.eggs ?? [], 'green') : { eggs: t.eggs ?? [], given: false };
  if (golden) egg.eggs = giveEgg(egg.eggs, 'gold').eggs;
  // Premio de descubridor: además de los puntos, 2 Hyper al primero que atrapa un token recién listado.
  const bag = { ...t.balls };
  if (discovered) bag.hyper += DISCOVER_HYPER;
  await weekAdd(t, points, 0, discovered ? 1 : 0);
  if (t.referred_by && !t.ref_paid && catches >= REF_AFTER_CATCHES) await payReferrer(t);
  await saveTrainer(t, {
    ...withPoints(t, points), balls: bag,
    missions: progressed(t, catchEvents(tier, speciesById(enc.line).type, discovered)),
    eggs: egg.eggs,
    stats: { ...t.stats, catches, shinies: (t.stats?.shinies ?? 0) + (enc.shiny ? 1 : 0), disc: (t.stats?.disc ?? 0) + (discovered ? 1 : 0) },
    extra: (t.extra ?? []).filter((e) => e.id !== enc.spawn_id),
  });
  const after = await F.afterCatch(t, { spawnId: enc.spawn_id, token: enc.token, mcap: enc.token ? enc.mcap : 0, name: monName, golden });
  if (Object.keys(after.patch).length) await saveTrainer(t, after.patch);
  if (tok) {
    await db.from('feed').insert({
      kind: discovered ? 'discover' : 'catch', trainer_name: t.name, token: enc.token, symbol: tok.symbol, logo: tok.logo,
      species: mon.name, shiny: enc.shiny, mcap: enc.mcap, stage_to: stage,
    });
  } else if (golden || tier === 'Legendary') {
    await db.from('feed').insert({ kind: 'catch', trainer_name: t.name, species: mon.name, shiny: enc.shiny, stage_to: stage });
  }
  const box = await boxOf(t.id);
  return {
    caught: true, shakes, fled: false, chance, balls: t.balls, points, discovered, dexNo: tok?.dex_no ?? null,
    mon: box.find((b) => b.id === enc.spawn_id), egg: egg.given ? 'green' : null, golden,
    bonus: [discovered ? `Discoverer prize: +${DISCOVER_HYPER} Hyper Balls` : golden ? `Golden Monster! +${GOLD_POINTS} pts and a Gold Egg` : null, ...after.notes]
      .filter(Boolean).join(' · ') || null,
  };
}

async function battleStart(t: Trainer, monId: string) {
  const enc = await getEncounter(t);
  const box = await boxOf(t.id);
  const mon = box.find((b) => b.id === monId);
  if (!mon) throw new Fail('not your monster');
  const fainted = mon.token ? faintedOf(mon.token.m0, mon.token.marketCap) : false;
  if (fainted && !buffOn(t, 'revive')) throw new Fail('fainted: use a Revive');
  const pLevel = Math.max(MIN_PLAYER_LEVEL, mon.token ? levelOf(mon.token.m0, mon.token.marketCap) : WILD_LEVEL);
  const pStats = fighter(mon.speciesId, pLevel), fStats = fighter(enc.line, wildLevelOf(enc.mcap));
  const battle = { monId, sid: mon.speciesId, pLevel, pHp: pStats.maxHp, pMax: pStats.maxHp };
  await db.from('encounters').update({ battle }).eq('trainer_id', t.id);
  return { ...battle, pStats, fStats, foeHp: enc.foe_hp, foeMax: enc.foe_max, moves: movesFor(speciesById(mon.speciesId)) };
}

async function battleMove(t: Trainer, i: number) {
  const enc = await getEncounter(t);
  const b = enc.battle;
  if (!b) throw new Fail('no battle');
  const pSp = speciesById(b.sid), fSp = speciesById(enc.line);
  const pStats: Stats = fighter(b.sid, b.pLevel), fStats: Stats = fighter(enc.line, wildLevelOf(enc.mcap));
  const move = movesFor(pSp)[i];
  if (!move) throw new Fail('bad move');
  let foeHp = enc.foe_hp, pHp = b.pHp;
  const events: { side: 'foe' | 'player'; name: string; type: string; dmg: number; eff: number }[] = [];
  const playerTurn = () => { const r = damageOf(move, pStats, fStats, fSp.type); foeHp = Math.max(0, foeHp - r.dmg); events.push({ side: 'foe', name: move.name, type: move.type, ...r }); return foeHp <= 0; };
  const foeTurn = () => { const fm = movesFor(fSp)[Math.random() < 0.65 ? 0 : 1]; const r = damageOf(fm, fStats, pStats, pSp.type); pHp = Math.max(0, pHp - r.dmg); events.push({ side: 'player', name: fm.name, type: fm.type, ...r }); return pHp <= 0; };
  let foeDown = false, playerDown = false;
  if (pStats.spd >= fStats.spd) { foeDown = playerTurn(); if (!foeDown) playerDown = foeTurn(); }
  else { playerDown = foeTurn(); if (!playerDown) foeDown = playerTurn(); }
  const result = foeDown ? 'win' : playerDown ? 'lose' : null;
  if (foeDown) {
    await db.from('encounters').delete().eq('trainer_id', t.id);
    await saveTrainer(t, { missions: progressed(t, [{ k: 'win', n: 1 }]), stats: { ...t.stats, wins: (t.stats?.wins ?? 0) + 1 } });
  }
  else await db.from('encounters').update({ foe_hp: foeHp, battle: playerDown ? null : { ...b, pHp } }).eq('trainer_id', t.id);
  return { events, foeHp, pHp, result };
}

// ---------- tienda ----------
/** Lo que la Mart necesita mostrar y cobrar: red, token, tesorería y precios (el servidor manda). */
function martInfo() {
  return {
    chainId: PAY.chainId, chainName: PAY.chainName, rpc: PAY.rpc, explorer: PAY.explorer,
    token: PAY.token, decimals: PAY.decimals, symbol: PAY.symbol, treasury: MART_MODE === 'burn' ? DEAD : PAY.treasury, mode: MART_MODE,
    ready: isAddr(PAY.token) && isAddr(PAY.treasury), prices: PRICES,
  };
}

function priceOf(item: string): bigint {
  const p = PRICES[item];
  if (!MART[item] || !p) throw new Fail('unknown item');
  return parseUnits(p, PAY.decimals);
}

/** Antes de firmar: el objeto existe, cabe (huevos) y la wallet es la de la cuenta. Devuelve a quién y cuánto pagar. */
function buyCheck(t: Trainer, item: string) {
  const amount = priceOf(item);
  if (!isAddr(PAY.treasury) || !isAddr(PAY.token)) throw new Fail('the Mart is not set up yet', 503);
  if (!t.wallet) throw new Fail('connect your wallet first', 403);
  grantOf(t, item);
  return { item, to: MART_MODE === 'burn' ? DEAD : PAY.treasury, mode: MART_MODE, token: PAY.token, amount: amount.toString(), price: PRICES[item], symbol: PAY.symbol, chainId: PAY.chainId };
}

/**
 * Comprueba en la red que `txHash` es un pago de la wallet de la cuenta por al menos `price`: a la tesorería, o en
 * modo 'burn' a 0x…dEaD (vale un transfer directo o un swap que envía el token a dEaD firmado por la wallet).
 */
async function verifyPayment(t: Trainer, txHash: string, price: bigint) {
  const burn = MART_MODE === 'burn';
  const r = await verifyTransfer(txHash, {
    from: t.wallet!, to: burn ? DEAD : PAY.treasury, min: price, senderOk: burn,
    none: `no ${PAY.symbol} ${burn ? 'burn' : 'payment'} from your wallet ${burn ? 'to 0x…dEaD' : 'to the Mart'} in that transaction`,
  });
  return { paid: r.paid, block: r.block };
}

/**
 * Suma los Transfer del token `from` → `to` en la transacción y exige al menos `min`, confirmada y de menos de 24 h.
 * `senderOk`: también cuentan los Transfer a `to` desde otra dirección (p. ej. el pool de un swap) si quien firmó
 * la transacción es `from`.
 */
async function verifyTransfer(txHash: string, o: { from: string; to: string; min: bigint; senderOk?: boolean; none: string }) {
  const wallet = o.from.toLowerCase(), dest = o.to.toLowerCase();
  let rc;
  try {
    rc = await payChain.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (e) {
    if ((e as Error)?.name !== 'TransactionReceiptNotFoundError') throw new Fail('could not reach the network, try again', 502);
    const pending = await payChain.getTransaction({ hash: txHash as `0x${string}` }).catch(() => null);
    throw pending ? new Fail('payment not confirmed yet', 425) : new Fail(`transaction not found on ${PAY.chainName}`, 404);
  }
  if (rc.status !== 'success') throw new Fail('that transaction failed on-chain', 402);
  const pad = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;
  const bySender = !!o.senderOk && rc.from.toLowerCase() === wallet;
  let paid = 0n;
  for (const l of rc.logs) {
    if (l.address.toLowerCase() !== PAY.token || l.topics[0] !== TRANSFER_TOPIC || l.topics.length !== 3) continue;
    if (l.topics[2]?.toLowerCase() !== pad(dest)) continue;
    if (l.topics[1]?.toLowerCase() !== pad(wallet) && !bySender) continue;
    paid += BigInt(l.data);
  }
  if (paid === 0n) throw new Fail(o.none, 402);
  if (paid < o.min) throw new Fail(`payment too small: ${formatUnits(paid, PAY.decimals)} ${PAY.symbol}`, 402);
  const block = await payChain.getBlock({ blockNumber: rc.blockNumber }).catch(() => null);
  if (!block) throw new Fail('could not reach the network, try again', 502);
  if (Date.now() / 1000 - Number(block.timestamp) > PAY_MAX_AGE_S) throw new Fail('that payment is too old', 402);
  return { paid, block: rc.blockNumber };
}

/** Compra pagada: verifica la transacción, la marca como usada (una sola vez) y entrega el objeto. */
async function buy(t: Trainer, item: string, txHash: string) {
  const price = priceOf(item);
  if (!t.wallet) throw new Fail('connect your wallet first', 403);
  const hash = txHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Fail('pay with your wallet first (missing transaction)', 402);
  const { data: used } = await db.from('payments').select('tx_hash').eq('tx_hash', hash).maybeSingle();
  if (used) throw new Fail('that payment was already used', 409);
  const { paid, block } = await verifyPayment(t, hash, price);
  const patch = grantOf(t, item); // si no cabe (huevos), el hash sigue libre para reintentar
  const { error } = await db.from('payments').insert({
    tx_hash: hash, trainer_id: t.id, item, wallet: t.wallet, token: PAY.token, chain_id: PAY.chainId,
    amount: paid.toString(), block: Number(block),
  });
  if (error) throw new Fail(/duplicate/i.test(error.message) ? 'that payment was already used' : error.message, /duplicate/i.test(error.message) ? 409 : 500);
  await saveTrainer(t, patch);
  return { trainer: publicTrainer(t), txHash: hash, paid: formatUnits(paid, PAY.decimals), symbol: PAY.symbol };
}

/** Lo que cambia en el entrenador al recibir `item` (sin guardar). */
function grantOf(t: Trainer, item: string): Partial<Trainer> {
  const it = MART[item];
  if (!it) throw new Fail('unknown item');
  const balls = { ...t.balls };
  for (const k of BALL_KEYS) balls[k] += it.balls?.[k] ?? 0;
  const buffs = { ...t.buffs };
  if (it.buff && it.minutes) buffs[it.buff] = Math.max(buffs[it.buff] ?? 0, Date.now()) + it.minutes * 60_000;
  let extra = (t.extra ?? []).filter((e) => e.expiresAt > Date.now());
  if (it.spawns && it.minutes) {
    const pool = CATALOG.filter((s) => it.spawns!.tiers.includes(s.tier));
    const until = Date.now() + it.minutes * 60_000;
    for (let i = 0; i < it.spawns.n; i++) {
      extra.push({ id: `${item}-${Date.now()}-${i}`, line: pool[Math.floor(Math.random() * pool.length)].id, expiresAt: until, kind: item });
    }
    extra = extra.slice(-12);
  }
  let eggs = t.eggs ?? [];
  if (it.egg) {
    const g = giveEgg(eggs, it.egg);
    if (!g.given) throw new Fail(`your egg bag is full (${EGG_BAG_MAX})`);
    eggs = g.eggs;
  }
  if (item === 'summit') {
    // Un pase nuevo reinicia el cupo de legendarios; los primeros aparecen ya en la cumbre.
    const fresh = { buffs: { ...buffs, summitLeft: SUMMIT_TOTAL }, extra };
    const g = summitRefill({ ...t, ...fresh } as Trainer) ?? fresh;
    return { balls, buffs: g.buffs, extra: g.extra, eggs };
  }
  return { balls, buffs, extra, eggs };
}

// ---------- misiones ----------
function missionsView(m: Missions) {
  const now = Date.now(), w = weekOf(now);
  const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  return { ...m, reward: MISSION_REWARD, resetD: midnight - now, resetW: WEEK0 + (w + 1) * 7 * 864e5 - now };
}

async function missionsGet(t: Trainer) {
  const m = missionsOf(t);
  if (JSON.stringify(m) !== JSON.stringify(t.missions)) await saveTrainer(t, { missions: m });
  return missionsView(m);
}

async function missionClaim(t: Trainer, kind: string, i: number) {
  if (kind !== 'd' && kind !== 'w') throw new Fail('bad mission');
  const m = missionsOf(t);
  const list = kind === 'd' ? m.d : m.w;
  const x = list[i];
  if (!x) throw new Fail('bad mission');
  if (x.claimed) throw new Fail('already collected');
  if (x.p < x.goal) throw new Fail('not done yet');
  list[i] = { ...x, claimed: true };
  const r = kind === 'd' ? MISSION_REWARD.daily : MISSION_REWARD.weekly;
  const balls = { ...t.balls };
  for (const k of BALL_KEYS) balls[k] += r.balls[k] ?? 0;
  let eggs = t.eggs ?? [], egg: EggKind | null = null;
  const bonusKey = kind === 'd' ? 'bonusD' : 'bonusW';
  if (list.every((q) => q.claimed) && !m[bonusKey]) {
    m[bonusKey] = true;
    const kindEgg: EggKind = kind === 'd' ? 'green' : 'blue';
    const g = giveEgg(eggs, kindEgg);
    eggs = g.eggs; if (g.given) egg = kindEgg;
  }
  const pts = F.boostPts(t, r.points);
  await saveTrainer(t, { ...withPoints(t, pts), balls, missions: m, eggs });
  await weekAdd(t, pts);
  return { missions: missionsView(m), reward: r.balls, points: pts, egg, trainer: publicTrainer(t) };
}

// ---------- huevos ----------
function eggsView(t: Trainer) {
  return { walked: t.walked ?? 0, incubators: INCUBATORS, max: EGG_BAG_MAX, eggs: (t.eggs ?? []).map((e) => eggView(e, t.walked ?? 0)) };
}

/** El cliente cuenta los metros; el servidor los limita a lo que da tiempo a correr desde el último envío. */
async function walk(t: Trainer, d: number) {
  const now = Date.now();
  const since = t.walk_at ? (now - Date.parse(t.walk_at)) / 1000 : 15;
  const ok = Math.max(0, Math.min(Number(d) || 0, Math.min(since, 60) * MAX_WALK_SPEED));
  const walked = (t.walked ?? 0) + ok;
  await saveTrainer(t, { walked, walk_at: new Date(now).toISOString(), missions: progressed(t, [{ k: 'walk', n: Math.round(ok) }]) });
  const ready = (t.eggs ?? []).filter((e) => eggView(e, walked).progress >= 1).map((e) => e.id);
  return { walked, counted: ok, ready };
}

async function incubate(t: Trainer, id: string) {
  const eggs = t.eggs ?? [];
  const e = eggs.find((x) => x.id === id);
  if (!e) throw new Fail('no such egg');
  if (e.start != null) throw new Fail('already incubating');
  if (eggs.filter((x) => x.start != null).length >= INCUBATORS) throw new Fail('all incubators are busy');
  await saveTrainer(t, { eggs: eggs.map((x) => (x.id === id ? { ...x, start: t.walked ?? 0 } : x)) });
  return eggsView(t);
}

async function hatch(t: Trainer, id: string) {
  const eggs = t.eggs ?? [];
  const e = eggs.find((x) => x.id === id);
  if (!e) throw new Fail('no such egg');
  if (eggView(e, t.walked ?? 0).progress < 1) throw new Fail('keep walking: it is not ready yet');
  const line = hatchLine(e.kind), sp = speciesById(line), spawnId = `egg-${e.id}`;
  const shiny = isShiny(t, spawnId);
  const { error } = await db.from('box').insert({
    trainer_id: t.id, spawn_id: spawnId, token: null, species_id: line, name: speciesName(line, 1), tier: sp.tier,
    model: modelOf(line, 1), stage: 1, shiny, m0: null, discovered: false,
  });
  if (error && !/duplicate/i.test(error.message)) throw new Fail(error.message, 500);
  const points = F.boostPts(t, LEAGUE_POINTS[sp.tier] * (shiny ? 2 : 1), true);
  await saveTrainer(t, {
    ...withPoints(t, points),
    eggs: eggs.filter((x) => x.id !== id),
    missions: progressed(t, [{ k: 'hatch', n: 1 }]),
    stats: { ...t.stats, hatched: (t.stats?.hatched ?? 0) + 1, shinies: (t.stats?.shinies ?? 0) + (shiny ? 1 : 0) },
  });
  await weekAdd(t, points);
  const dex = await F.dexCheck(t);
  if (dex.patch) await saveTrainer(t, dex.patch);
  const box = await boxOf(t.id);
  return { kind: e.kind, notes: dex.notes, eggName: EGG[e.kind].name, points, mon: box.find((b) => b.id === spawnId), trainer: publicTrainer(t), ...eggsView(t) };
}

// ---------- cuentas ----------
async function guest(name?: string) {
  const nm = name && cleanText(name) && name.trim().length >= 3 ? name.trim().slice(0, 20) : `Trainer${Math.floor(1000 + Math.random() * 9000)}`;
  const { data: t, error } = await db.from('trainers').insert({ name: nm, balls: START_BALLS }).select('*').single();
  if (error) throw new Fail(error.message, 500);
  return { session: await newSession(t.id), ...(await me(t as Trainer)) };
}

const signMessage = (address: string, nonce: string) =>
  `PokeGrass on Arc wants you to sign in.\n\nWallet: ${address}\nNonce: ${nonce}\n\nThis only proves you own this wallet. It costs nothing.`;

async function walletNonce(address: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Fail('bad address');
  const nonce = randomHex(12);
  await db.from('nonces').upsert({ address: address.toLowerCase(), nonce, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  return { message: signMessage(address, nonce) };
}

async function walletLogin(req: Request, address: string, signature: `0x${string}`) {
  const addr = address.toLowerCase();
  const { data: n } = await db.from('nonces').select('*').eq('address', addr).maybeSingle();
  if (!n || Date.parse(n.expires_at) < Date.now()) throw new Fail('sign-in expired, try again');
  const ok = await verifyMessage({ address: address as `0x${string}`, message: signMessage(address, n.nonce), signature }).catch(() => false);
  if (!ok) throw new Fail('bad signature', 401);
  await db.from('nonces').delete().eq('address', addr);

  let current: Trainer | null = null;
  try { current = await trainerFromSession(req); } catch { /* entra sin sesión previa */ }
  const { data: owner } = await db.from('trainers').select('*').eq('wallet', addr).maybeSingle();
  let t: Trainer;
  if (owner) {                                                       // la wallet ya tenía entrenador: ese manda
    t = owner as Trainer;
    if (current && !current.wallet && current.id !== t.id) await F.mergeGuest(current.id, t.id);
  }
  else if (current && !current.wallet) { await saveTrainer(current, { wallet: addr }); t = current; } // el invitado se queda con la wallet
  else {
    const { data, error } = await db.from('trainers').insert({ name: `Trainer${Math.floor(1000 + Math.random() * 9000)}`, wallet: addr, balls: START_BALLS }).select('*').single();
    if (error) throw new Fail(error.message, 500);
    t = data as Trainer;
  }
  return { session: await newSession(t.id), ...(await me(t)) };
}

/** Clave de recuperación: 20 caracteres base32 (100 bits). Solo se guarda su sha256; crear una nueva anula la anterior. */
const RECOVERY_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^PG/, '');
async function recoveryKey(t: Trainer) {
  const raw = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => RECOVERY_ABC[b & 31]).join('');
  const recovery_hash = await sha256(raw);
  const { error } = await db.from('trainers').update({ recovery_hash }).eq('id', t.id);
  if (error) throw new Fail(error.message, 500);
  t.recovery_hash = recovery_hash;
  return { key: `PG-${raw.match(/.{5}/g)!.join('-')}` };
}
async function recover(key: string) {
  const raw = normKey(key);
  if (raw.length !== 20) throw new Fail('that key does not look right');
  const { data: t } = await db.from('trainers').select('*').eq('recovery_hash', await sha256(raw)).maybeSingle();
  if (!t) throw new Fail('no account with that key', 404);
  return { session: await newSession(t.id), ...(await me(t as Trainer)) };
}

/** Sube una sola vez la colección que el jugador tenía en este navegador (antes del servidor). */
async function importLocal(t: Trainer, collection: any[]) {
  if (t.imported) return me(t);
  const rows: any[] = [];
  for (const m of (Array.isArray(collection) ? collection : []).slice(0, 60)) {
    const addr = String(m?.token?.address ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) continue;
    const symbol = String(m.token.symbol ?? '').slice(0, 24), name = String(m.token.name ?? symbol).slice(0, 64);
    if (!cleanText(symbol) || !cleanText(name)) continue;
    const line = lineOf(addr, name, symbol);
    await db.from('tokens').upsert({
      address: addr, symbol, name, logo: m.token.logo ?? null, mcap: Number(m.token.marketCap) || 0,
      line, stage: stageOf(Number(m.token.marketCap) || 0),
    }, { onConflict: 'address', ignoreDuplicates: true });
    const m0 = Number(m.token.m0) || Number(m.token.marketCap) || 0, stage = stageOf(m0);
    rows.push({
      trainer_id: t.id, spawn_id: `t-${addr}`, token: addr, species_id: line, name: symbol,
      tier: rarityOf(m0), model: modelOf(line, stage), stage, shiny: !!m.shiny, m0, imported: true,
      caught_at: new Date(Number(m.caughtAt) || Date.now()).toISOString(),
    });
  }
  if (rows.length) await db.from('box').upsert(rows, { onConflict: 'trainer_id,spawn_id', ignoreDuplicates: true });
  await saveTrainer(t, { imported: true });
  return me(t);
}

// ---------- tablero ----------
async function board(t: Trainer | null) {
  const w = weekOf(Date.now());
  const top = (col: 'wins' | 'disc') => db.from('week_scores').select(`${col}, trainers(name, wallet)`).eq('week_id', w).gt(col, 0)
    .order(col, { ascending: false }).limit(10);
  const [{ data: arena }, { data: disc }, { data: won }, { data: bestCatch }, { data: elo }] = await Promise.all([
    top('wins'), top('disc'),
    db.from('prizes').select('*').gte('week_id', w - 4).order('week_id', { ascending: false }).order('rank').limit(30),
    db.from('week_scores').select('best_mcap, best_name, trainers(name, wallet)').eq('week_id', w).gt('best_mcap', 0).order('best_mcap', { ascending: false }).limit(10),
    db.from('trainers').select('name, wallet, elo').neq('elo', 1000).gte('seen_at', new Date(Date.now() - 30 * 864e5).toISOString()).order('elo', { ascending: false }).limit(10),
  ]);
  const mini = (col: 'wins' | 'disc') => (r: any, i: number) => ({ rank: i + 1, name: r.trainers?.name ?? '?', wallet: !!r.trainers?.wallet, points: r[col] });
  const extra = {
    arena: (arena ?? []).map(mini('wins')), discoverers: (disc ?? []).map(mini('disc')),
    winners: (won ?? []).map((p: any) => ({ ...prizeView(p), wallet: p.wallet ? `${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)}` : null })),
    prizes: PRIZES, prizeMinHold: PRIZE_MIN_HOLD, symbol: PAY.symbol,
    catches: (bestCatch ?? []).map((r: any, i: number) => ({ rank: i + 1, name: r.trainers?.name ?? '?', wallet: !!r.trainers?.wallet, points: Math.round(Number(r.best_mcap)), mon: r.best_name })),
    elo: (elo ?? []).map((r: any, i: number) => ({ rank: i + 1, name: r.name, wallet: !!r.wallet, points: r.elo })),
  };
  const [{ data: week }, { data: all }, { data: feed }] = await Promise.all([
    db.from('trainers').select('name, wallet, week_points, stats').eq('week_id', w).gt('week_points', 0).order('week_points', { ascending: false }).limit(20),
    db.from('trainers').select('name, wallet, score, stats').gt('score', 0).order('score', { ascending: false }).limit(20),
    db.from('feed').select('*').order('at', { ascending: false }).limit(30),
  ]);
  const row = (r: any, pts: number, i: number) => ({ rank: i + 1, name: r.name, wallet: !!r.wallet, points: pts, catches: r.stats?.catches ?? 0, disc: r.stats?.disc ?? 0, shinies: r.stats?.shinies ?? 0 });
  let myRank: number | null = null;
  if (t && t.week_id === w && t.week_points > 0) {
    const { count } = await db.from('trainers').select('id', { count: 'exact', head: true }).eq('week_id', w).gt('week_points', t.week_points);
    myRank = (count ?? 0) + 1;
  }
  return {
    weekEndsAt: WEEK0 + (w + 1) * 7 * 864e5,
    week: (week ?? []).map((r: any, i: number) => row(r, r.week_points, i)),
    allTime: (all ?? []).map((r: any, i: number) => row(r, r.score, i)),
    feed: (feed ?? []).map((f: any) => ({ ...f, at: Date.parse(f.at) })),
    myRank, ...extra,
  };
}

// ---------- pantalla del token (config pública) ----------
let tokenStats: { at: number; v: any } | null = null;
async function tokenInfo() {
  if (!tokenStats || Date.now() - tokenStats.at > 60_000) {
    const [dead, treasury, { data: pays }] = await Promise.all([
      balanceOf(DEAD).catch(() => null),
      MART_MODE === 'treasury' && isAddr(PAY.treasury) ? balanceOf(PAY.treasury).catch(() => null) : Promise.resolve(null),
      db.from('payments').select('amount').eq('token', PAY.token).eq('chain_id', PAY.chainId).limit(5000),
    ]);
    const viaMart = (pays ?? []).reduce((n: bigint, p: any) => n + BigInt(String(p.amount).split('.')[0]), 0n);
    tokenStats = {
      at: Date.now(),
      v: {
        burned: dead === null ? null : formatUnits(dead, PAY.decimals),
        treasuryBalance: treasury === null ? null : formatUnits(treasury, PAY.decimals),
        martTotal: formatUnits(viaMart, PAY.decimals), martPayments: (pays ?? []).length,
      },
    };
  }
  return {
    chainId: PAY.chainId, chainName: PAY.chainName, mainnet: MAINNET, explorer: PAY.explorer,
    address: PAY.token, symbol: PAY.symbol, decimals: PAY.decimals, name: TOKEN.name,
    buyUrl: TOKEN.buyUrl, chartUrl: TOKEN.chartUrl, tokenUrl: TOKEN.tokenUrl,
    martMode: MART_MODE, treasury: PAY.treasury, dead: DEAD,
    tiers: tierConfig(), prizes: PRIZES, prizeMinHold: PRIZE_MIN_HOLD, prices: PRICES,
    stats: tokenStats.v, updatedAt: tokenStats.at, extra: F.prizesConfig(),
  };
}

// ---------- invitaciones y referidos ----------
const REF_AFTER_CATCHES = 5;
const REF_REWARD: Partial<Record<BallKey, number>> = { super: 5, hyper: 1 };
const DISCOVER_HYPER = 2;
async function ensureRefCode(t: Trainer) {
  if (t.ref_code) return;
  for (let i = 0; i < 3; i++) {
    const code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => RECOVERY_ABC[b & 31]).join('');
    const { error } = await db.from('trainers').update({ ref_code: code }).eq('id', t.id).is('ref_code', null);
    if (!error) { t.ref_code = code; return; }
  }
}
/** El invitado recibe su premio al usar el código; quien invitó, cuando el invitado atrapa 5 (freno a las granjas). */
async function useReferral(t: Trainer, code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.referred_by) throw new Fail('you already used an invite code');
  if (Date.now() - Date.parse(t.created_at) > 7 * 864e5) throw new Fail('invite codes are for accounts less than 7 days old');
  const { data: host } = await db.from('trainers').select('id, referred_by').eq('ref_code', c).maybeSingle();
  if (!host) throw new Fail('no trainer with that invite code', 404);
  if (host.id === t.id || host.referred_by === t.id) throw new Fail('you cannot use that code');
  const balls = { ...t.balls };
  for (const k of BALL_KEYS) balls[k] += REF_REWARD[k] ?? 0;
  const { data: ok } = await db.from('trainers').update({ referred_by: host.id, balls }).eq('id', t.id).is('referred_by', null).select('id');
  if (!ok?.length) throw new Fail('you already used an invite code');
  Object.assign(t, { referred_by: host.id, balls });
  return { trainer: publicTrainer(t), reward: REF_REWARD, after: REF_AFTER_CATCHES };
}
async function payReferrer(t: Trainer) {
  const { data: won } = await db.from('trainers').update({ ref_paid: true }).eq('id', t.id).eq('ref_paid', false).select('id');
  t.ref_paid = true;
  if (!won?.length || !t.referred_by) return;
  const { data: h } = await db.from('trainers').select('balls, stats').eq('id', t.referred_by).maybeSingle();
  if (!h) return;
  const balls = { ...h.balls };
  for (const k of BALL_KEYS) balls[k] = (balls[k] ?? 0) + (REF_REWARD[k] ?? 0);
  await db.from('trainers').update({ balls, stats: { ...h.stats, refs: (h.stats?.refs ?? 0) + 1 } }).eq('id', t.referred_by);
}

// ---------- premios semanales y panel de admin ----------
const PRIZE_COL: Record<PrizeCat, 'points' | 'wins' | 'disc' | 'best_mcap'> = { league: 'points', arena: 'wins', discoverer: 'disc', catch: 'best_mcap' };
async function isAdmin(t: Trainer) {
  if (!t.wallet) return false;
  if (ADMIN_WALLETS.includes(t.wallet)) return true;
  const { data } = await db.from('admins').select('wallet').eq('wallet', t.wallet).maybeSingle();
  return !!data;
}
async function requireAdmin(t: Trainer) { if (!(await isAdmin(t))) throw new Fail('admins only', 403); }

/** Cierra la semana `wk`: por categoría, los primeros con wallet y saldo mínimo (leído en la red al cerrar). */
async function closeWeek(wk: number, by: string) {
  const { data: done } = await db.from('week_closes').select('week_id').eq('week_id', wk).maybeSingle();
  if (done) return { week: wk, already: true };
  const { error: lockErr } = await db.from('week_closes').insert({ week_id: wk, closed_by: by });
  if (lockErr) return { week: wk, already: true };
  const min = parseUnits(PRIZE_MIN_HOLD, PAY.decimals);
  const rows: any[] = [];
  let skipped = 0;
  for (const cat of Object.keys(PRIZE_COL) as PrizeCat[]) {
    const amounts = PRIZES[cat] ?? [];
    if (!amounts.length) continue;
    const col = PRIZE_COL[cat];
    const { data } = await db.from('week_scores').select(`trainer_id, ${col}, trainers(name, wallet)`)
      .eq('week_id', wk).gt(col, 0).order(col, { ascending: false }).limit(40);
    for (const r of (data ?? []) as any[]) {
      if (rows.filter((x) => x.category === cat).length >= amounts.length) break;
      const wallet = r.trainers?.wallet as string | null;
      const bal = wallet ? await balanceOf(wallet).catch(() => null) : null;
      if (!wallet || bal === null || bal < min) { skipped++; continue; }
      const rank = rows.filter((x) => x.category === cat).length + 1;
      rows.push({
        week_id: wk, category: cat, rank, trainer_id: r.trainer_id, name: r.trainers?.name ?? '?', wallet, score: Math.min(2147483647, Math.round(Number(r[col]))),
        amount: amounts[rank - 1], token: PAY.token, chain_id: PAY.chainId,
      });
    }
  }
  if (rows.length) {
    const { error } = await db.from('prizes').insert(rows);
    if (error) { await db.from('week_closes').delete().eq('week_id', wk); throw new Fail(error.message, 500); }
  }
  await db.from('week_closes').update({ winners: rows.length, skipped }).eq('week_id', wk);
  return { week: wk, winners: rows.length, skipped };
}

const prizeView = (p: any) => ({
  id: p.id, week: p.week_id, category: p.category, rank: p.rank, name: p.name, wallet: p.wallet, score: p.score,
  amount: p.amount, symbol: PAY.symbol, status: p.status, txHash: p.tx_hash, paidAt: p.paid_at ? Date.parse(p.paid_at) : null,
});

async function adminView(t: Trainer) {
  await requireAdmin(t);
  const w = weekOf(Date.now());
  const [{ data: prizes }, { data: closes }] = await Promise.all([
    db.from('prizes').select('*').gte('week_id', w - 8).order('week_id', { ascending: false }).order('category').order('rank'),
    db.from('week_closes').select('*').gte('week_id', w - 8).order('week_id', { ascending: false }),
  ]);
  return {
    week: w, weekEndsAt: WEEK0 + (w + 1) * 7 * 864e5, admin: t.wallet, token: PAY.token, symbol: PAY.symbol, decimals: PAY.decimals,
    chainId: PAY.chainId, explorer: PAY.explorer, prizes: (prizes ?? []).map(prizeView), config: PRIZES, minHold: PRIZE_MIN_HOLD,
    closes: (closes ?? []).map((c: any) => ({ week: c.week_id, at: Date.parse(c.closed_at), by: c.closed_by, winners: c.winners, skipped: c.skipped })),
  };
}

/** El admin pagó desde su wallet: se verifica en la red (del admin al ganador, al menos el importe) y se registra. */
async function adminPaid(t: Trainer, id: number, txHash: string) {
  await requireAdmin(t);
  const hash = txHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Fail('bad transaction hash');
  const { data: p } = await db.from('prizes').select('*').eq('id', id).maybeSingle();
  if (!p) throw new Fail('no such prize', 404);
  if (p.status === 'paid') throw new Fail('already paid', 409);
  if (p.token !== PAY.token || Number(p.chain_id) !== PAY.chainId) throw new Fail('that prize is in another token/network', 409);
  const [{ data: usedPrize }, { data: usedPay }] = await Promise.all([
    db.from('prizes').select('id').eq('tx_hash', hash).maybeSingle(),
    db.from('payments').select('tx_hash').eq('tx_hash', hash).maybeSingle(),
  ]);
  if (usedPrize || usedPay) throw new Fail('that transaction was already used', 409);
  await verifyTransfer(hash, {
    from: t.wallet!, to: p.wallet, min: parseUnits(p.amount, PAY.decimals),
    none: `no ${PAY.symbol} transfer from your admin wallet to the winner in that transaction`,
  });
  const { data: ok, error } = await db.from('prizes').update({ status: 'paid', tx_hash: hash, paid_by: t.wallet, paid_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending').select('*');
  if (error) throw new Fail(/duplicate/i.test(error.message) ? 'that transaction was already used' : error.message, 409);
  if (!ok?.length) throw new Fail('already paid', 409);
  return { prize: prizeView(ok[0]) };
}

// ---------- intercambios ----------
async function publicBox(id: string) {
  const { data: tr } = await db.from('trainers').select('id, name').eq('id', id).maybeSingle();
  if (!tr) throw new Fail('no such trainer', 404);
  return { id: tr.id, name: tr.name, box: (await boxOf(id)).slice(-80) };
}
async function findTrainer(name: string) {
  const nm = name.trim();
  if (nm.length < 3) throw new Fail('type at least 3 letters');
  const { data } = await db.from('trainers').select('id, name').ilike('name', `${nm.replace(/[%_\\]/g, '\\$&')}%`).order('seen_at', { ascending: false }).limit(5);
  return { trainers: data ?? [] };
}
async function tradeOffer(t: Trainer, to: string, give: string, want: string) {
  if (!/^[0-9a-f-]{36}$/.test(to) || to === t.id) throw new Fail('pick another trainer');
  const [{ data: a }, { data: b }, { count }] = await Promise.all([
    db.from('box').select('spawn_id').eq('trainer_id', t.id).eq('spawn_id', give).maybeSingle(),
    db.from('box').select('spawn_id').eq('trainer_id', to).eq('spawn_id', want).maybeSingle(),
    db.from('trades').select('id', { count: 'exact', head: true }).eq('from_id', t.id).eq('status', 'pending'),
  ]);
  if (!a) throw new Fail('that monster is not in your box');
  if (!b) throw new Fail('they do not have that monster anymore');
  const [mine, theirs] = await Promise.all([F.listedIds(t.id), F.listedIds(to)]);
  if (mine.has(give) || theirs.has(want)) throw new Fail('that card is on the market');
  if ((count ?? 0) >= 5) throw new Fail('you already have 5 offers waiting');
  const { data, error } = await db.from('trades').insert({ from_id: t.id, to_id: to, give, want }).select('id').single();
  if (error) throw new Fail(error.message, 500);
  return { id: data.id };
}
async function tradesView(t: Trainer) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data } = await db.from('trades').select('*').or(`from_id.eq.${t.id},to_id.eq.${t.id}`).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(20);
  const list = data ?? [];
  const ids = [...new Set(list.flatMap((x: any) => [x.from_id, x.to_id]))];
  const spawns = [...new Set(list.flatMap((x: any) => [x.give, x.want]))];
  const [{ data: names }, { data: mons }] = await Promise.all([
    db.from('trainers').select('id, name').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    db.from('box').select('spawn_id, trainer_id, name, tier, shiny, stage, model').in('spawn_id', spawns.length ? spawns : ['-']).in('trainer_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
  ]);
  const nm = new Map((names ?? []).map((n: any) => [n.id, n.name]));
  const mon = (owner: string, sid: string) => {
    const m = (mons ?? []).find((x: any) => x.spawn_id === sid && x.trainer_id === owner);
    return m ? { id: sid, name: m.name, tier: m.tier, shiny: m.shiny, stage: m.stage, model: m.model } : { id: sid, name: '(gone)', tier: 'Common', shiny: false, stage: 1, model: '' };
  };
  return {
    trades: list.map((x: any) => ({
      id: x.id, status: x.status, mine: x.from_id === t.id, at: Date.parse(x.created_at),
      from: { id: x.from_id, name: nm.get(x.from_id) ?? '?' }, to: { id: x.to_id, name: nm.get(x.to_id) ?? '?' },
      // tras el cambio las cartas ya están con el otro: se buscan donde estén
      give: x.status === 'done' ? mon(x.to_id, x.give) : mon(x.from_id, x.give),
      want: x.status === 'done' ? mon(x.from_id, x.want) : mon(x.to_id, x.want),
    })),
  };
}
async function tradeAccept(t: Trainer, id: string) {
  const { data, error } = await db.rpc('trade_accept', { p_id: id, p_to: t.id });
  if (error) throw new Fail(error.message, 500);
  if (data !== 'ok') throw new Fail(String(data), 409);
  return { ok: true, box: await boxOf(t.id) };
}
async function tradeClose(t: Trainer, id: string) {
  const { data } = await db.from('trades').select('from_id, to_id').eq('id', id).eq('status', 'pending').maybeSingle();
  if (!data || (data.from_id !== t.id && data.to_id !== t.id)) throw new Fail('no such offer');
  await db.from('trades').update({ status: data.from_id === t.id ? 'cancelled' : 'declined' }).eq('id', id).eq('status', 'pending');
  return { ok: true };
}

// ---------- tick (pg_cron cada minuto) ----------
const GT = 'https://api.geckoterminal.com/api/v2';
const GT_HEADERS = { Accept: 'application/json;version=20230302' };
const num = (v: unknown) => { const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? n : 0; };

async function gtPools(path: string) {
  const r = await fetch(`${GT}${path}`, { headers: GT_HEADERS });
  if (!r.ok) return [];
  const j = await r.json();
  const logos = new Map<string, string>();
  for (const x of j.included ?? []) { const img = x.attributes?.image_url; if (img && img !== 'missing.png') logos.set(String(x.id).split('_').pop()!.toLowerCase(), img); }
  return (j.data ?? []).map((p: any) => {
    const a = p.attributes ?? {};
    const address = String(p.relationships?.base_token?.data?.id ?? '').split('_').pop()!.toLowerCase();
    const symbol = String(a.name ?? '').split('/')[0].trim();
    return {
      address, symbol, name: symbol, logo: logos.get(address) ?? null, mcap: num(a.market_cap_usd) || num(a.fdv_usd),
      liquidity: num(a.reserve_in_usd), launched_at: a.pool_created_at ?? new Date().toISOString(),
    };
  }).filter((x: any) => /^0x[0-9a-f]{40}$/.test(x.address));
}

// DexScreener es la fuente de los salvajes. No tiene "todos los tokens de una cadena": se descubren con los pools
// contra USDC nativo (top 30 por liquidez) + búsquedas + los lanzamientos nuevos de GeckoTerminal (solo como pista de
// direcciones), y todo lo ya descubierto queda en `tokens` y se vuelve a consultar. Caché: DS_TTL_MS entre consultas.
const DS = 'https://api.dexscreener.com';
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const DS_TTL_MS = 3 * 60_000;
/** Un token cuenta como "en la hierba" si DexScreener lo devolvió hace menos de esto. */
const DS_FRESH_MS = 30 * 60_000;
const MIN_LIQ = 500;
/** Market cap → si falta FDV → si tampoco, la liquidez del pool. */
const capOf = (p: any) => num(p?.marketCap) || num(p?.fdv) || num(p?.liquidity?.usd);

/** Pools de DexScreener → token → su pool de más liquidez (el USDC nativo nunca es un monstruo). */
function dsIndex(pairs: any[], into: Map<string, any>) {
  for (const p of pairs) {
    if (p?.chainId && p.chainId !== 'arc') continue;
    const flip = String(p?.baseToken?.address ?? '').toLowerCase() === ARC_USDC;
    const tok = flip ? p.quoteToken : p.baseToken;
    const a = String(tok?.address ?? '').toLowerCase();
    if (!isAddr(a) || a === ARC_USDC) continue;
    if (into.has(a) && num(into.get(a).liquidity?.usd) >= num(p.liquidity?.usd)) continue;
    into.set(a, { ...p, baseToken: tok });
  }
}
const dsGet = (path: string) => fetch(`${DS}${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function tick() {
  // Tareas de la semana y eventos, pase lo que pase con la caché de DexScreener.
  const prevWeek = weekOf(Date.now()) - 1;
  await Promise.all([
    closeWeek(prevWeek, 'auto').catch((e) => console.error('closeWeek', e)),
    maybeGolden().catch((e) => console.error('golden', e)),
  ]);
  const { data: last } = await db.from('tokens').select('ds_seen_at').not('ds_seen_at', 'is', null)
    .order('ds_seen_at', { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.ds_seen_at) < DS_TTL_MS) { await cleanup(); return { cached: true }; }

  const ds = new Map<string, any>();
  const [usdcPairs, ...searches] = await Promise.all([
    dsGet(`/token-pairs/v1/arc/${ARC_USDC}`),
    ...['arc', 'arc usdc', 'arc eurc'].map((q) => dsGet(`/latest/dex/search?q=${encodeURIComponent(q)}`)),
  ]);
  dsIndex(Array.isArray(usdcPairs) ? usdcPairs : [], ds);
  for (const j of searches) dsIndex(j?.pairs ?? [], ds);
  const hints = [
    ...await gtPools('/networks/arc/new_pools?page=1&include=base_token'),
    ...await gtPools('/networks/arc/trending_pools?page=1&include=base_token'),
  ];

  // Lo ya descubierto (primero lo que alguien tiene en su Caja) + las pistas nuevas: detalle por lotes de 30.
  const { data: owned } = await db.from('tokens').select('address').gt('catches', 0).order('updated_at', { ascending: true }).limit(60);
  const { data: known } = await db.from('tokens').select('address').order('updated_at', { ascending: true }).limit(120);
  // Las pistas de GeckoTerminal van primero, no al final: son el único canal por el que entra un token
  // recién lanzado (la consulta de pools de DexScreener devuelve el top 30 por liquidez, donde un token de
  // minutos no está). Al final de la lista, el corte de 150 se los comía enteros en cuanto `tokens` juntaba
  // suficientes filas conocidas, y entonces ningún lanzamiento nuevo volvía a entrar en el mundo.
  const want = [...new Set([
    ...hints.map((h: any) => h.address),
    ...(owned ?? []).map((o: any) => o.address),
    ...(known ?? []).map((o: any) => o.address),
  ])].filter((a) => !ds.has(a)).slice(0, 150);
  for (let i = 0; i < want.length; i += 30) {
    const j = await dsGet(`/tokens/v1/arc/${want.slice(i, i + 30).join(',')}`);
    if (Array.isArray(j)) dsIndex(j, ds);
  }

  // "En tendencia" = los de más volumen en 24 h entre los que devolvió DexScreener.
  const hotSet = new Set([...ds.entries()].sort((a, b) => num(b[1].volume?.h24) - num(a[1].volume?.h24)).slice(0, 8).map(([a]) => a));
  const fresh = [...ds.entries()]
    .filter(([, p]) => num(p.liquidity?.usd) >= MIN_LIQ && cleanText(p.baseToken?.symbol ?? '') && cleanText(p.baseToken?.name ?? ''))
    .map(([address, p]) => ({
      address, symbol: String(p.baseToken.symbol), name: String(p.baseToken.name), logo: p.info?.imageUrl ?? null, mcap: capOf(p),
      liquidity: num(p.liquidity?.usd), launched_at: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : undefined,
      hot: hotSet.has(address),
    }));
  const trending = fresh.filter((x) => x.hot);

  const all = new Map<string, any>(fresh.map((x) => [x.address, x]));
  for (const a of (owned ?? []).map((o: any) => o.address)) if (!all.has(a) && ds.has(a)) all.set(a, { address: a });
  const { data: prev } = await db.from('tokens').select('address, stage, catches, symbol, logo, line, launched_at, hot').in('address', [...all.keys()]);
  const before = new Map((prev ?? []).map((p: any) => [p.address, p]));

  const nowIso = new Date().toISOString();
  const rows: any[] = [], evolved: any[] = [];
  for (const x of all.values()) {
    const d = ds.get(x.address), old = before.get(x.address);
    const symbol = d?.baseToken?.symbol || x.symbol || old?.symbol || '?';
    const name = d?.baseToken?.name || x.name || symbol;
    const mcap = d ? capOf(d) : x.mcap ?? 0;
    const stage = stageOf(mcap);
    const row: any = {
      address: x.address, symbol: symbol.slice(0, 24), name: name.slice(0, 64), logo: d?.info?.imageUrl || x.logo || old?.logo || null,
      mcap, liquidity: num(d?.liquidity?.usd) || x.liquidity || 0, line: old?.line ?? lineOf(x.address, name, symbol), stage,
      // un upsert por lotes rellena con NULL las columnas que falten: todas las filas llevan las mismas
      launched_at: x.launched_at ?? old?.launched_at ?? nowIso, hot: !!x.hot,
      updated_at: nowIso, ds_seen_at: nowIso,
    };
    rows.push(row);
    if (old && stage > old.stage && old.catches > 0) {
      evolved.push({ kind: 'evolve', token: x.address, symbol: row.symbol, logo: row.logo, species: row.symbol, stage_from: old.stage, stage_to: stage, mcap });
    }
  }
  // Las evoluciones no se deshacen: si el token vuelve a caer, el monstruo se queda en su etapa (pero baja de nivel).
  for (const e of evolved) {
    const line = rows.find((r) => r.address === e.token)?.line;
    if (!line) continue;
    // El nombre del monstruo es el símbolo del token: al evolucionar solo cambian etapa, modelo y rareza.
    await db.from('box').update({ stage: e.stage_to, model: modelOf(line, e.stage_to), tier: rarityOf(e.mcap) })
      .eq('token', e.token).lt('stage', e.stage_to);
  }
  await db.from('tokens').update({ hot: false }).eq('hot', true).not('address', 'in', `(${trending.map((x: any) => `"${x.address}"`).join(',') || '""'})`);
  if (rows.length) {
    const { error } = await db.from('tokens').upsert(rows, { onConflict: 'address' });
    if (error) throw new Fail(error.message, 500);
  }
  if (evolved.length) await db.from('feed').insert(evolved);
  await cleanup();
  return { tokens: rows.length, evolved: evolved.length, trending: trending.length, discovered: ds.size };
}

async function cleanup() {
  const now = Date.now();
  await Promise.all([
    db.from('sessions').delete().lt('seen_at', new Date(now - SESSION_IDLE_MS).toISOString()),
    db.from('nonces').delete().lt('expires_at', new Date(now).toISOString()),
    db.from('rate_hits').delete().lt('at', new Date(now - 2 * 3600_000).toISOString()).not('key', 'like', 'guestd:%'),
    db.from('rate_hits').delete().lt('at', new Date(now - 25 * 3600_000).toISOString()),
  ]);
}

async function tickAllowed(req: Request) {
  const given = req.headers.get('x-tick-secret');
  if (!given) return false;
  const { data } = await db.rpc('tick_secret_ok', { s: given });
  return data === true;
}

// ---------- equipo, gimnasios, arena, mercado, legendarios y premios instantáneos (features.ts) ----------
const F = makeFeatures({
  db, fail: (m, s) => new Fail(m, s), pay: PAY, envOr, verifyTransfer, boxOf: boxOf as any, saveTrainer: saveTrainer as any,
  weekAdd: weekAdd as any, withPoints: withPoints as any, publicTrainer: publicTrainer as any,
  holdTier: (t: any) => (t.wallet ? holdTier(t.hold_bal) : null), balanceOf, prizeMinHold: PRIZE_MIN_HOLD, weekOf, today, buffOn: buffOn as any,
  fresh: async () => (await encounterable()).all, progressWin: (t: any) => progressed(t, [{ k: 'win', n: 1 }]), mainnet: MAINNET,
});

// ---------- entrada ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const a = String(body.action ?? '');
    if (IP_RATE[a] && !(await allowed(`${a}:${ipOf(req)}`, ...IP_RATE[a]))) {
      throw new Fail('too many tries, wait a bit', 429, { code: 'rate_limited', retryAfterSec: retryAfter(IP_RATE[a][1]) });
    }
    if (a === 'guest') {
      for (const [k, lim, win] of GUEST_RATE) {
        if (!(await allowed(`${k}:${ipOf(req)}`, lim, win))) {
          throw new Fail('too many new players from your network', 429, { code: 'rate_limited_guest', retryAfterSec: retryAfter(win) });
        }
      }
    }
    switch (a) {
      case 'guest': return json(await guest(body.name));
      case 'recover': return json(await recover(String(body.key ?? '')));
      case 'nonce': return json(await walletNonce(String(body.address ?? '')));
      case 'wallet': return json(await walletLogin(req, String(body.address ?? ''), body.signature));
      case 'tick': {
        if (!(await tickAllowed(req))) throw new Fail('forbidden', 403);
        return json(await tick());
      }
      case 'mart': return json(martInfo());
      case 'token': return json(await tokenInfo());
      case 'discovered': return json(await F.discovered(Number(body.offset) || 0));
      case 'board': {
        let t: Trainer | null = null;
        try { t = await trainerFromSession(req); } catch { /* el tablero es público */ }
        return json(await board(t));
      }
    }
    const t = await trainerFromSession(req);
    switch (a) {
      case 'me': return json(await me(t));
      case 'route': return json(await route(t));
      case 'encounter': return json(await startEncounter(t, String(body.spawnId ?? '')));
      case 'throw': return json(await throwBall(t, body.ball, Number(body.quality)));
      case 'flee': await db.from('encounters').delete().eq('trainer_id', t.id); return json({ ok: true });
      case 'battle-start': return json(await battleStart(t, String(body.monId ?? '')));
      case 'battle-move': return json(await battleMove(t, Number(body.i)));
      case 'battle-leave': await db.from('encounters').update({ battle: null }).eq('trainer_id', t.id); return json({ ok: true });
      case 'buy-check': return json(buyCheck(t, String(body.item ?? '')));
      case 'buy': return json(await buy(t, String(body.item ?? ''), String(body.txHash ?? '')));
      case 'import': return json(await importLocal(t, body.collection));
      case 'missions': return json(await missionsGet(t));
      case 'mission': return json(await missionClaim(t, String(body.kind ?? ''), Number(body.i)));
      case 'eggs': return json(eggsView(t));
      case 'walk': return json(await walk(t, Number(body.d)));
      case 'incubate': return json(await incubate(t, String(body.id ?? '')));
      case 'hatch': return json(await hatch(t, String(body.id ?? '')));
      case 'recovery-key': return json(await recoveryKey(t));
      case 'holder': await refreshHold(t, !!body.force && Date.now() - Date.parse(t.hold_at ?? '1970') > 30_000); await claimDaily(t); return json({ trainer: publicTrainer(t) });
      case 'referral': return json(await useReferral(t, String(body.code ?? '')));
      case 'trainer-box': return json(await publicBox(String(body.id ?? '')));
      case 'trainer-find': return json(await findTrainer(String(body.name ?? '')));
      case 'trade-offer': return json(await tradeOffer(t, String(body.to ?? ''), String(body.give ?? ''), String(body.want ?? '')));
      case 'trades': return json(await tradesView(t));
      case 'trade-accept': return json(await tradeAccept(t, String(body.id ?? '')));
      case 'trade-close': return json(await tradeClose(t, String(body.id ?? '')));
      case 'admin': return json(await adminView(t));
      case 'admin-close': {
        await requireAdmin(t);
        const wk = Number(body.week), cur = weekOf(Date.now());
        if (!Number.isInteger(wk) || wk > cur || wk < cur - 52) throw new Fail('bad week');
        return json(await closeWeek(wk, t.wallet!));
      }
      case 'admin-paid': return json(await adminPaid(t, Number(body.id), String(body.txHash ?? '')));
      case 'admin-golden': await requireAdmin(t); return json({ event: await startGolden(t.wallet!) });
      case 'logout': await db.from('sessions').delete().eq('token_hash', await sha256(req.headers.get('x-session')!)); return json({ ok: true });
      case 'rename': {
        const nm = String(body.name ?? '').trim();
        if (nm.length < 3 || nm.length > 20 || !cleanText(nm)) throw new Fail('pick a 3–20 letter name');
        await saveTrainer(t, { name: nm });
        return json({ trainer: publicTrainer(t) });
      }
      default: {
        const r = await F.handle(a, t, body);
        if (r === undefined) throw new Fail('unknown action');
        return json(r);
      }
    }
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    if (status >= 500) console.error(e);
    const extra = e instanceof Fail ? e.extra : {};
    const headers = typeof extra.retryAfterSec === 'number' ? { 'Retry-After': String(extra.retryAfterSec) } : undefined;
    return json({ error: e instanceof Error ? e.message : String(e), ...extra }, status, headers);
  }
});
