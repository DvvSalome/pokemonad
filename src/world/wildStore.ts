// Los monstruos salvajes del mundo. Con feed, son tokens recién lanzados en Arc (lib/arc/tokens.ts): cada
// uno se convierte en su especie/etapa (tokenSpecies.ts) y se planta repartido por su zona, en un punto
// que sale del hash de la dirección — así el mismo token aparece en el mismo sitio para todos. Si el feed
// falla o viene vacío se quedan los monstruos de demo de species.ts, para que el mundo nunca esté vacío.
import { useSyncExternalStore } from 'react';
import { SPAWNS as DEMO_SPAWNS, SPECIES_CATALOG, type Spawn, type Species } from './species';
import { PLACES, PLACE_KEYS, walkable, onPier, pathDist, dist, POND, ARENA, COLISEUM } from './terrain';
import { fetchDexArcTokens, type ArcToken } from '../../lib/arc/tokens';
import {
  lineOf, stageOf, modelOf, rarityOf, catchRate, cleanText, hash32,
} from './tokenSpecies';
import { call, isOnline, type RouteResult, type ServerEvent, type ServerExtra } from '../../lib/api';
import { setServerShiny } from './buffs';

export type WildSource = 'demo' | 'loading' | 'arc' | 'error';

interface WildState { spawns: Spawn[]; source: WildSource; updatedAt: number }

let s: WildState = { spawns: DEMO_SPAWNS, source: 'demo', updatedAt: 0 };
const listeners = new Set<() => void>();
function set(next: Partial<WildState>) { s = { ...s, ...next }; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export const useWild = (): WildState => useSyncExternalStore(subscribe, () => s, () => s);
export const getSpawns = () => s.spawns;
export const spawnById = (id: string | null): Spawn | undefined => (id ? s.spawns.find((sp) => sp.id === id) : undefined);

/** Salvajes como mucho por zona: con más, las manchas se vuelven una multitud. */
const PER_ZONE = 6;
/** Separación mínima entre monstruos, en metros. */
const MIN_GAP = 6;
/** Anillo de la zona donde se reparten, en fracciones de su radio: ni pegados al centro ni en el borde. */
const SCATTER = [0.15, 0.78];

/** Suelo firme, fuera de caminos, charca y coliseo (el coliseo es solo para combates). */
function spawnFits(x: number, z: number): boolean {
  if (!walkable(x, z) || onPier(x, z)) return false;
  if (pathDist(x, z) < 1.8) return false;
  if (dist(x, z, POND) < POND.r + 1.5) return false;
  if (dist(x, z, ARENA) < COLISEUM.wall + COLISEUM.wallT + 3) return false;
  return true;
}
const STAGE_SIZE = [2.2, 2.7, 3.2];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Token → monstruo salvaje. Devuelve null si el nombre no pasa el filtro de contenido. */
export function spawnFromToken(t: ArcToken, taken: { x: number; z: number }[]): Spawn | null {
  if (!cleanText(t.name) || !cleanText(t.symbol)) return null;
  const line = lineOf(t.address, t.name, t.symbol);
  const base = SPECIES_CATALOG.find((sp) => sp.id === line);
  if (!base) return null;
  const stage = stageOf(t.marketCap);

  const place = PLACES[base.zone];
  if (!place) return null;
  const R = rng(hash32(`spot-${t.address}`));
  let x = place.x, z = place.z;
  for (let tries = 0; tries < 40; tries++) {
    const a = R() * Math.PI * 2;
    const r = place.r * (SCATTER[0] + Math.sqrt(R()) * (SCATTER[1] - SCATTER[0]));
    const cx = place.x + Math.cos(a) * r, cz = place.z + Math.sin(a) * r;
    if (!spawnFits(cx, cz)) continue;
    x = cx; z = cz;
    if (taken.every((q) => (q.x - x) ** 2 + (q.z - z) ** 2 > MIN_GAP * MIN_GAP)) break;
  }

  return {
    id: `t-${t.address}`,
    // El nombre que se ve ES el del token (símbolo, o nombre si no hay símbolo). El tipo/modelo siguen saliendo
    // de la línea del bestiario (determinista por dirección), pero el monstruo se llama como el token real.
    species: { ...base, name: t.symbol || t.name, tier: rarityOf(t.marketCap) },
    model: modelOf(line, stage),
    x, z,
    size: STAGE_SIZE[stage - 1] * (base.flying ? 0.92 : 1),
    stage,
    base: catchRate(t.marketCap, line),
    token: {
      address: t.address, symbol: t.symbol, name: t.name,
      marketCap: t.marketCap, liquidityUsd: t.liquidityUsd, createdAt: t.createdAt, logo: t.imageUrl,
    },
  };
}

/** Posición del jugador en el plano, escrita cada frame por CaptureController (para Lure y ocultos). */
export const playerPos = { x: 0, z: 0 };

/** Teletransporte pendiente (Dex "Find it"): Player lo consume al inicio del frame. */
let pendingWarp: { x: number; z: number } | null = null;
/** Encola un warp a la entrada de una zona (meadow, lake, …). */
export function warpToZone(zone: string) {
  const p = PLACES[zone];
  if (!p) return;
  pendingWarp = { x: p.entry[0], z: p.entry[1] };
}
/** Devuelve y limpia el warp pendiente, o null. */
export function takeWarp(): { x: number; z: number } | null {
  const w = pendingWarp;
  pendingWarp = null;
  return w;
}

// ---------- salvajes privados de la tienda (Lure, Safari) ----------
let extra: Spawn[] = [];
/** Monstruos de evento (Dorado): uno para todos, en un lugar fijo del mapa. */
let golden: Spawn[] = [];
const mergeSpawns = (feed: Spawn[]) => [...feed.filter((sp) => !sp.kind || sp.kind === 'wild'), ...extra, ...golden];

/**
 * Trae `count` monstruos de las rarezas pedidas junto al jugador durante `minutes` minutos. Como el Lure
 * del original: solo los ve quien lo usa. Sin token, así que su % es el de su especie.
 */
export function addPrivateSpawns(kind: 'lure' | 'safari', count: number, tiers: Species['tier'][], minutes: number) {
  const pool = SPECIES_CATALOG.filter((sp) => tiers.includes(sp.tier));
  if (!pool.length) return;
  const now = Date.now();
  const taken: { x: number; z: number }[] = [...s.spawns];
  const add: Spawn[] = [];
  for (let i = 0; i < count; i++) {
    const base = pool[Math.floor(Math.random() * pool.length)];
    const { x, z } = spotNearPlayer(taken);
    taken.push({ x, z });
    add.push({
      id: `${kind}-${now}-${i}`, species: base, model: modelOf(base.id, 1), x, z,
      size: STAGE_SIZE[0] * (base.flying ? 0.92 : 1), stage: 1, kind, expiresAt: now + minutes * 60_000,
    });
  }
  extra = [...extra, ...add];
  set({ spawns: mergeSpawns(s.spawns) });
}

/**
 * Con servidor, los salvajes privados son los que él guarda (trainer.extra). Se colocan junto al jugador la
 * primera vez que llegan y conservan su sitio en los refrescos siguientes.
 */
export function setServerExtra(list: ServerExtra[]) {
  setServerShiny(list.map((e) => [e.id, e.shiny]));
  const prev = new Map(extra.map((sp) => [sp.id, sp]));
  const taken: { x: number; z: number }[] = [...s.spawns];
  extra = list.filter((e) => e.expiresAt > Date.now()).map((e) => {
    const old = prev.get(e.id);
    if (old) return old;
    const base = SPECIES_CATALOG.find((sp) => sp.id === e.line) ?? SPECIES_CATALOG[0];
    // Los legendarios del Summit Pass esperan en la cumbre; Lure y Safari vienen a ti.
    const summit = e.kind === 'summit';
    const { x, z } = summit ? spotNear(PLACES.summit, PLACES.summit.r * 0.55, taken) : spotNearPlayer(taken);
    taken.push({ x, z });
    return {
      id: e.id, species: summit ? { ...base, tier: 'Legendary' as const } : base, model: modelOf(base.id, 1), x, z,
      size: STAGE_SIZE[0] * (base.flying ? 0.92 : 1), stage: 1, kind: e.kind, expiresAt: e.expiresAt,
    };
  });
  set({ spawns: mergeSpawns(s.spawns) });
}

/** Un punto caminable cerca de `c` (radio `r`), lejos de los ya ocupados. */
function spotNear(c: { x: number; z: number }, r: number, taken: { x: number; z: number }[], seed = Math.random) {
  for (let tries = 0; tries < 40; tries++) {
    const a = seed() * Math.PI * 2, d = r * (0.25 + 0.75 * seed()) * (1 + tries / 20);
    const cx = c.x + Math.cos(a) * d, cz = c.z + Math.sin(a) * d;
    if (!walkable(cx, cz)) continue;
    if (!taken.every((q) => (q.x - cx) ** 2 + (q.z - cz) ** 2 > MIN_GAP * MIN_GAP)) continue;
    return { x: cx, z: cz };
  }
  return { x: c.x, z: c.z };
}

// ---------- eventos ----------
let events: ServerEvent[] = [];
const eventListeners = new Set<() => void>();
export const useEvents = () => useSyncExternalStore(
  (l) => { eventListeners.add(l); return () => { eventListeners.delete(l); }; }, () => events, () => events,
);
/** El Monstruo Dorado activo (y sin dueño) pasa a ser un salvaje más, igual para todos: sitio sacado de su id. */
function setEvents(list: ServerEvent[]) {
  events = list;
  eventListeners.forEach((l) => l());
  const prev = new Map(golden.map((sp) => [sp.id, sp]));
  golden = list.filter((e) => e.kind === 'golden' && !e.caughtBy && e.endsAt > Date.now()).map((e) => {
    const old = prev.get(e.id);
    if (old) return old;
    const base = SPECIES_CATALOG.find((sp) => sp.id === e.line) ?? SPECIES_CATALOG[0];
    const place = PLACES[PLACE_KEYS[e.spot % PLACE_KEYS.length]];
    const { x, z } = spotNear(place, place.r * 0.45, [], rng(hash32(e.id)));
    return {
      id: e.id, species: { ...base, name: `Golden ${base.name}` }, model: modelOf(base.id, 1), x, z,
      size: STAGE_SIZE[1] * (base.flying ? 0.92 : 1), stage: 1, kind: 'golden', expiresAt: e.endsAt,
    };
  });
  setServerShiny(golden.map((sp) => [sp.id, true]));
  set({ spawns: mergeSpawns(s.spawns) });
}
/** Lugar del mapa donde está un evento (para el aviso). */
export const eventPlace = (e: ServerEvent) => PLACE_KEYS[e.spot % PLACE_KEYS.length];

function spotNearPlayer(taken: { x: number; z: number }[]) {
  for (let tries = 0; tries < 24; tries++) {
    const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 7;
    const cx = playerPos.x + Math.cos(a) * r, cz = playerPos.z + Math.sin(a) * r;
    if (!walkable(cx, cz)) continue;
    if (!taken.every((q) => (q.x - cx) ** 2 + (q.z - cz) ** 2 > MIN_GAP * MIN_GAP)) continue;
    return { x: cx, z: cz };
  }
  return { x: playerPos.x, z: playerPos.z };
}

setInterval(() => {
  const now = Date.now();
  const alive = (sp: Spawn) => sp.id === pinned || (sp.expiresAt ?? Infinity) > now;
  const left = extra.filter(alive), gold = golden.filter(alive);
  if (left.length === extra.length && gold.length === golden.length) return;
  extra = left; golden = gold;
  set({ spawns: mergeSpawns(s.spawns) });
}, 3000);

/** Tokens → lista de salvajes, respetando el tope por zona (en el orden que llegan: el servidor ya los sortea). */
export function spawnsFromTokens(tokens: ArcToken[]): Spawn[] {
  const out: Spawn[] = [];
  const perZone = new Map<string, number>();
  for (const t of tokens) {
    const sp = spawnFromToken(t, out);
    if (!sp) continue;
    const n = perZone.get(sp.species.zone) ?? 0;
    if (n >= PER_ZONE) continue;
    perZone.set(sp.species.zone, n + 1);
    out.push(sp);
  }
  return out;
}

// Tokens vistos en esta sesión. El feed de "nuevos pools" rota en minutos: sin acumular, un monstruo podía
// esfumarse mientras el jugador caminaba hacia él.
const known = new Map<string, ArcToken>();
const KNOWN_MAX = 80;
/** Spawn que no puede desaparecer en un refresco (el del encuentro en curso). */
let pinned: string | null = null;
export const pinSpawn = (id: string | null) => { pinned = id; };

/** Salvajes de la ventana actual según el servidor (nuevos + en tendencia, sin los ya atrapados, con su shiny). */
async function routeTokens(): Promise<ArcToken[]> {
  const r = await call<RouteResult>('route');
  setServerShiny(r.spawns.map((x) => [`t-${x.address}`, x.shiny]));
  if (r.extra) setServerExtra(r.extra);
  setEvents(r.events ?? []);
  known.clear();
  return r.spawns.map((x): ArcToken => ({
    address: x.address, symbol: x.symbol, name: x.name, marketCap: x.marketCap, priceUsd: 0,
    liquidityUsd: x.liquidityUsd, createdAt: x.createdAt, imageUrl: x.logo,
  }));
}

let loading: Promise<void> | null = null;
/** Descarga el feed de Arc y rehace los salvajes. Conserva el objeto de los que ya estaban (sin saltos). */
export function refreshWild(): Promise<void> {
  if (loading) return loading;
  if (s.source === 'demo') set({ source: 'loading' });
  loading = (async () => {
    try {
      const online = isOnline();
      const tokens = online ? await routeTokens() : await fetchDexArcTokens({ minLiquidityUsd: 500 });
      for (const t of tokens) known.set(t.address, t);
      const newest = [...known.values()].sort((a, b) => b.createdAt - a.createdAt);
      for (const t of newest.slice(KNOWN_MAX)) known.delete(t.address);

      const prev = new Map(s.spawns.map((sp) => [sp.id, sp]));
      const keep = pinned ? prev.get(pinned) : undefined;
      const fresh = spawnsFromTokens([...known.values()]);
      // Sin servidor, cero salvajes es un fallo del feed y los de demo son la red de seguridad. Con servidor
      // es un dato: él manda sobre qué existe. Dejar los de la ventana anterior en pantalla convertía "ahora
      // no hay nada en la hierba" en "todos los monstruos fallan al tirar", porque el servidor ya no los
      // tiene y rechaza cada `encounter` uno por uno. Se queda solo el del encuentro en curso.
      if (!fresh.length) {
        if (online) set({ spawns: mergeSpawns(keep ? [keep] : []), source: 'arc', updatedAt: Date.now() });
        else set({ source: s.source === 'arc' ? 'arc' : 'demo' });
        return;
      }
      const next = fresh.map((sp) => prev.get(sp.id) ?? sp);
      if (keep && !next.some((sp) => sp.id === keep.id)) next.push(keep);
      set({ spawns: mergeSpawns(next), source: 'arc', updatedAt: Date.now() });
    } catch (err) {
      console.warn('[wild] feed de Arc no disponible, sigo con los de demo', err);
      set({ source: s.spawns === DEMO_SPAWNS ? 'error' : s.source });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Arranca el feed y lo refresca cada 90 s (la ventana de ruta del servidor; sin servidor, DexScreener directo). */
export function startWildFeed() {
  if (timer) return;
  void refreshWild();
  timer = setInterval(() => { void refreshWild(); }, 90_000);
}
export function stopWildFeed() {
  if (timer) clearInterval(timer);
  timer = null;
}
