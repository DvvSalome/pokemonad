// Estado del encuentro de captura, portado en espíritu de research/pokegrass-source/js/capture.js. Con
// servidor, él decide si la bola atrapa (lib/api.ts); sin conexión, la misma fórmula corre aquí (species.ts). Es una tienda observable
// mínima — parte reactiva por useSyncExternalStore (fase, bola, inventario, atrapados) y parte mutable por
// frame (posición del monstruo en pantalla y factor del aro), que los componentes 3D/DOM leen sin provocar
// re-render. Mismo patrón "estado compartido" que occluder en toon.ts.
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import {
  SPECIES_CATALOG, BALLS, BALL_ORDER, baseCatch, catchChance,
  type BallKey, type Spawn, type SpawnToken, type Species, type Tier,
} from './species';
import { fighter } from './battleMath';
import { spawnById, pinSpawn } from './wildStore';
import { levelOf, faintedOf, wildLevelOf } from './tokenSpecies';
import { isShiny } from './buffs';
import { call, isOnline, type EncounterResult, type ServerMon, type ThrowResult } from '../../lib/api';
import { t, onLangChange, type Key } from '../i18n';
import { THROW_MS, ABSORB_MS, shakeMs, CAUGHT_HOLD_MS, BROKE_MS } from './capture/timing';
import { gainCatch } from './progressStore';
import { getLang } from '../i18n';

/** Nivel de los monstruos salvajes (como en PokeGrass: "Lv 5"). */
export const WILD_LEVEL = 5;

/**
 * Un monstruo de la colección del jugador. Con token, su nivel crece con el market cap desde la captura
 * (levelOf del original: +13 por cada duplicación) y se debilita si el token cae por debajo del 35%.
 */
export interface CaughtMon {
  /** Id del salvaje que fue (t-0x… para tokens). */
  id: string;
  speciesId: string;
  name: string;
  tier: Tier;
  model: string;
  stage: number;
  caughtAt: number;
  /** Salió shiny (paleta girada, aura rosa, carta holográfica). */
  shiny?: boolean;
  /** `m0` = market cap al atraparlo; `marketCap` = el último conocido; `dexNo` = orden de descubrimiento global. */
  token?: SpawnToken & { m0: number; dexNo?: number | null };
  /** Fue el primer entrenador del mundo en atrapar este token. */
  discovered?: boolean;
}

export const monLevel = (m: CaughtMon) => (m.token ? levelOf(m.token.m0, m.token.marketCap) : WILD_LEVEL);
/** Colores del ejemplar para su retrato: los de su token y si es shiny. */
export const monLook = (m: CaughtMon) => ({ logo: m.token?.logo, symbol: m.token?.symbol, shiny: !!m.shiny });
export const monFainted = (m: CaughtMon) => !!m.token && faintedOf(m.token.m0, m.token.marketCap);
/** La especie del catálogo con el nombre de etapa y la rareza de este ejemplar (lo que pintan carta y combate). */
export function monSpecies(m: CaughtMon): Species | undefined {
  const base = SPECIES_CATALOG.find((s) => s.id === m.speciesId);
  return base && { ...base, name: m.name, tier: m.tier };
}

/** Carta a revelar (al atrapar, o al tocar una carta en la Caja). */
export interface RevealCard { mon: CaughtMon; dexNo: number; level: number; shiny: boolean }
const dexNoOf = (speciesId: string) => SPECIES_CATALOG.findIndex((s) => s.id === speciesId) + 1;

/** Fases del encuentro: apuntar → lanzar → absorber → temblar → veredicto. */
export type Phase = 'aim' | 'throw' | 'absorb' | 'shake' | 'caught' | 'broke' | 'fled';

export interface Snapshot {
  activeId: string | null;
  nearbyId: string | null;
  phase: Phase;
  ball: BallKey;
  balls: Record<BallKey, number>;
  /** IDs de ejemplares atrapados (dejan de aparecer en el mundo). */
  caught: ReadonlySet<string>;
  /** IDs de especie descubiertas (marcan el Dex). */
  caughtSpecies: ReadonlySet<string>;
  /** Monstruos atrapados, en orden de captura (la Caja de cartas y el equipo de combate). */
  collection: CaughtMon[];
  message: string;
  qualityLabel: string;
  /** Veredicto final para la UI: null mientras el encuentro sigue en juego. */
  result: 'caught' | 'broke' | 'fled' | null;
  /** Carta a mostrar en el overlay de revelado; null = ninguna. */
  reveal: RevealCard | null;
  /** Vida del monstruo salvaje en el encuentro (la reduce el combate → sube la captura). */
  foeHp: number;
  foeMax: number;
  /** El salvaje del encuentro es shiny (se fija al empezar: que caduque el Charm no se lo quita). */
  shiny: boolean;
}

const START_BALLS: Record<BallKey, number> = { ball: 5, super: 2, hyper: 0, hood: 1 };

// Con servidor (lib/api.ts) la colección y la bolsa son las suyas y el localStorage es solo caché; sin
// conexión, el juego sigue en local con esta misma partida (y la primera vez que conecta se sube, ver online.ts).
const SAVE_KEY = 'pg-save-v1';
interface Save { collection: CaughtMon[]; caught: string[]; balls: Record<BallKey, number> }
function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Save>;
      return { collection: v.collection ?? [], caught: v.caught ?? [], balls: { ...START_BALLS, ...v.balls } };
    }
  } catch { /* partida corrupta o sin storage: empezar de cero */ }
  return { collection: [], caught: [], balls: { ...START_BALLS } };
}
function persist() {
  try {
    const save: Save = { collection: snap.collection, caught: [...snap.caught], balls: snap.balls };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch { /* storage lleno o bloqueado: la partida sigue en memoria */ }
}

const saved = loadSave();
let snap: Snapshot = {
  activeId: null, nearbyId: null, phase: 'aim', ball: 'ball',
  balls: saved.balls, caught: new Set(saved.caught),
  caughtSpecies: new Set(saved.collection.map((m) => m.speciesId)), collection: saved.collection,
  message: '', qualityLabel: '', result: null, reveal: null, foeHp: 0, foeMax: 0, shiny: false,
};

const listeners = new Set<() => void>();
function emit() { snap = { ...snap }; listeners.forEach((l) => l()); }
/** Mensaje del narrador y calificación del tiro como funciones: se repintan si cambia el idioma a mitad del encuentro. */
let msgFn: (() => string) | null = null;
let qualityKey: Key | null = null;
function say(fn: () => string) { msgFn = fn; return fn(); }
onLangChange(() => {
  if (!snap.activeId) return;
  snap = { ...snap, message: msgFn ? msgFn() : snap.message, qualityLabel: qualityKey && snap.qualityLabel ? t(qualityKey) : snap.qualityLabel };
  listeners.forEach((l) => l());
});
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return snap; }

/** Hook de lectura reactiva del estado de captura. */
export function useCapture(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** ¿Hay un encuentro en curso? Se lee cada frame para congelar al jugador. */
export const isEncounterActive = () => snap.activeId !== null;
// Getters imperativos para leer sin suscribirse (useFrame, listeners de teclado).
export const getActiveId = () => snap.activeId;
export const getNearbyId = () => snap.nearbyId;
export const getPhase = () => snap.phase;
export const getEncounterShiny = () => snap.shiny;
export const getCaught = (): ReadonlySet<string> => snap.caught;

/** Campos por frame: no disparan render, se leen desde useFrame / rAF. */
export const live = {
  ringK: 1,
  ringClock: 0,
  screen: { x: 0, y: 0, size: 200, visible: false },
  targetPos: new THREE.Vector3(),
};

/** Probabilidad base del salvaje: la de su token (con market cap) o la de su especie, subida al debilitarlo. */
const baseOf = (spawn: Spawn) => Math.min(0.985, (spawn.base ?? baseCatch(spawn.species.rate)) * weakenFactor());
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Calidad del tiro según lo pequeño que esté el aro al lanzar (mismo baremo que el original). */
function quality(ringK: number): { q: number; label: string } {
  qualityKey = ringK < 0.3 ? 'capture.excellent' : ringK < 0.5 ? 'capture.great' : ringK < 0.72 ? 'capture.nice' : null;
  const q = ringK < 0.3 ? 1.35 : ringK < 0.5 ? 1.22 : ringK < 0.72 ? 1.1 : 1;
  return { q, label: qualityKey ? t(qualityKey) : '' };
}

const firstBall = (): BallKey => BALL_ORDER.find((k) => snap.balls[k] > 0) ?? 'ball';

// ---------- acciones ----------
export function setNearby(id: string | null) {
  if (snap.activeId) return; // en pleno encuentro no cambia el "cercano"
  if (snap.nearbyId === id) return;
  snap = { ...snap, nearbyId: id };
  listeners.forEach((l) => l());
}

/** Con servidor: el encuentro existe allí cuando esta promesa resuelve a true (el tiro la espera). */
let serverEncounter: Promise<boolean> = Promise.resolve(true);

export function startEncounter(id: string) {
  if (snap.activeId) return;
  const spawn = spawnById(id);
  if (!spawn || snap.caught.has(id)) return;
  live.ringClock = 0; live.ringK = 1; live.screen.visible = true;
  pinSpawn(id);
  const st = fighter(spawn.species.id, wildLevelOf(spawn.token?.marketCap ?? 0));
  const shiny = isShiny(id);
  snap = {
    ...snap, activeId: id, nearbyId: null, phase: 'aim', result: null,
    ball: firstBall(), qualityLabel: '', foeHp: st.maxHp, foeMax: st.maxHp, shiny,
    message: say(() => t(shiny ? 'capture.appearedShiny' : 'capture.appeared', { name: spawn.species.name })),
  };
  listeners.forEach((l) => l());
  if (!isOnline()) { serverEncounter = Promise.resolve(true); return; }
  serverEncounter = call<EncounterResult>('encounter', { spawnId: id }).then((r) => {
    if (snap.activeId !== id) return false;
    snap = { ...snap, foeHp: r.foeHp, foeMax: r.foeMax, shiny: r.shiny };
    listeners.forEach((l) => l());
    return true;
  }).catch((err: Error) => {
    if (snap.activeId !== id) return false;
    snap = { ...snap, phase: 'fled', result: 'fled', message: say(() => t('capture.gone', { name: spawn.species.name, msg: err.message })) };
    listeners.forEach((l) => l());
    return false;
  });
}

export function selectBall(k: BallKey) {
  if (snap.phase !== 'aim' || snap.balls[k] <= 0) return;
  snap = { ...snap, ball: k, message: say(() => t('capture.ballReady', { ball: BALLS[k].name })) };
  listeners.forEach((l) => l());
}

export function runAway() {
  if (!snap.activeId || snap.phase === 'throw' || snap.phase === 'absorb' || snap.phase === 'shake') return;
  if (snap.result === 'caught' && !snap.reveal) return; // celebrando: la carta está a punto de salir
  if (isOnline()) void call('flee').catch(() => { /* el siguiente encuentro lo reemplaza de todos modos */ });
  endEncounter();
}

export function endEncounter() {
  live.screen.visible = false;
  pinSpawn(null);
  snap = { ...snap, activeId: null, nearbyId: null, phase: 'aim', qualityLabel: '', message: '', result: null, foeHp: 0, foeMax: 0, shiny: false };
  listeners.forEach((l) => l());
}

// ---------- puente con el combate por turnos (battleStore) ----------
/** Factor que multiplica la probabilidad base: 1 (lleno) → 1.7 (casi KO). */
export function weakenFactor(): number {
  if (snap.foeMax <= 0) return 1;
  return 1 + 0.7 * (1 - snap.foeHp / snap.foeMax);
}
export const getFoeHp = () => snap.foeHp;
export const getFoeMax = () => snap.foeMax;
/** El combate reporta la nueva vida del salvaje tras cada turno. */
export function setFoeHp(hp: number) {
  const v = Math.max(0, Math.min(snap.foeMax, Math.round(hp)));
  if (v === snap.foeHp) return;
  snap = { ...snap, foeHp: v };
  listeners.forEach((l) => l());
}

let throwing = false;
export async function throwBall() {
  if (throwing || snap.phase !== 'aim' || !snap.activeId) return;
  const spawn = spawnById(snap.activeId);
  if (!spawn) return;
  const ball = snap.ball;
  if (snap.balls[ball] <= 0) {
    snap = { ...snap, message: say(() => t('capture.noBall', { ball: BALLS[ball].name })) };
    listeners.forEach((l) => l());
    return;
  }
  throwing = true;
  try {
    const { q, label } = quality(live.ringK);
    // Con servidor, el tiro se resuelve allí mientras la bola vuela (la animación tapa la latencia).
    const remote = isOnline()
      ? serverEncounter.then((ok) => (ok ? call<ThrowResult>('throw', { ball, quality: q }) : Promise.reject(new Error(t('capture.monsterGone')))))
      : null;
    remote?.catch(() => { /* se trata abajo */ });
    const before = snap.balls;
    const nextBalls = { ...snap.balls, [ball]: snap.balls[ball] - 1 };
    snap = { ...snap, phase: 'throw', qualityLabel: label, balls: nextBalls, message: say(() => t('capture.threw', { ball: BALLS[ball].name })) };
    listeners.forEach((l) => l());
    persist();
    await wait(THROW_MS); // vuelo de la bola (CaptureBall la anima)

    snap = { ...snap, phase: 'absorb' }; emit();
    await wait(ABSORB_MS); // el monstruo se convierte en luz y entra

    let caughtNow: boolean, shakes: number, server: ThrowResult | null = null;
    if (remote) {
      try {
        server = await remote;
      } catch (err) {
        snap = { ...snap, phase: 'aim', balls: before, message: say(() => t('capture.throwFail', { msg: (err as Error).message })) };
        listeners.forEach((l) => l());
        persist();
        return;
      }
      caughtNow = server.caught; shakes = server.shakes;
      snap = { ...snap, balls: server.balls };
    } else {
      const chance = catchChance(baseOf(spawn), ball, q);
      caughtNow = Math.random() < chance;
      shakes = caughtNow ? 3 : chance > 0.6 ? 2 : chance > 0.33 ? 1 : 0;
      const __f = (window as unknown as { __forceCatch?: [boolean, number] }).__forceCatch; if (__f) { caughtNow = __f[0]; shakes = __f[1]; } // TEMPQA
    }

    snap = { ...snap, phase: 'shake' }; emit();
    await wait(shakeMs(shakes)); // caída y temblores

    if (caughtNow) {
      const caught = new Set(snap.caught); caught.add(spawn.id);
      const caughtSpecies = new Set(snap.caughtSpecies); caughtSpecies.add(spawn.species.id);
      const mon: CaughtMon = server?.mon ? fromServer(server.mon) : {
        id: spawn.id, speciesId: spawn.species.id, name: spawn.species.name, tier: spawn.species.tier,
        model: spawn.model, stage: spawn.stage ?? 1, caughtAt: Date.now(), shiny: snap.shiny || undefined,
        token: spawn.token && { ...spawn.token, m0: spawn.token.marketCap },
      };
      const collection = [...snap.collection.filter((m) => m.id !== mon.id), mon];
      const reveal: RevealCard = { mon, dexNo: dexNoOf(mon.speciesId), level: monLevel(mon), shiny: !!mon.shiny };
      const disc = server?.discovered ? { symbol: mon.token?.symbol ?? '', no: server.dexNo ?? '' } : null;
      const points = server?.points ?? 0, gotEgg = !!server?.egg, name = spawn.species.name;
      snap = { ...snap, phase: 'caught', result: 'caught', caught, caughtSpecies, collection, message: say(() => t('capture.gotcha', { name }) + (disc ? t('capture.firstInWorld', disc) : '') + (points ? t('capture.pts', { n: points }) : '') + (gotEgg ? t('capture.greenEgg') : '')) };
      if (server) window.dispatchEvent(new Event('pg:progress'));
      gainCatch(spawn.id, name, getLang() === 'es');
      listeners.forEach((l) => l());
      persist();
      await wait(CAUGHT_HOLD_MS); // clic y estrellas en 3D antes de la carta
      snap = { ...snap, reveal };
      listeners.forEach((l) => l());
      return;
    }

    // Se soltó. Los raros/épicos pueden huir; los comunes se quedan para reintentar.
    const fleeChance = { Common: 0, Uncommon: 0.08, Rare: 0.18, Epic: 0.3, Legendary: 0.4 }[spawn.species.tier];
    const fled = server ? server.fled : Math.random() < fleeChance;
    const brokeKey = (['capture.broke0', 'capture.broke1', 'capture.broke2'] as const)[Math.min(2, shakes)];
    snap = { ...snap, phase: 'broke', message: say(() => (fled ? t('capture.fled', { name: spawn.species.name }) : t(brokeKey))) }; emit();
    await wait(BROKE_MS); // la bola revienta y el monstruo reaparece
    if (snap.activeId !== spawn.id) return;
    if (fled) {
      snap = { ...snap, phase: 'fled', result: 'fled' };
      listeners.forEach((l) => l());
      return;
    }
    const out = snap.balls[snap.ball] <= 0 && BALL_ORDER.every((k) => snap.balls[k] <= 0);
    snap = { ...snap, phase: 'aim', ball: snap.balls[snap.ball] > 0 ? snap.ball : firstBall(), message: say(() => (out ? t('capture.outOfBalls') : t('capture.tryAgain', { msg: t(brokeKey) }))) };
    listeners.forEach((l) => l());
  } finally {
    throwing = false;
  }
}

/** Abre el revelado de carta de un monstruo de la colección (desde la Caja). */
export function showCard(monId: string) {
  const mon = snap.collection.find((m) => m.id === monId);
  if (!mon) return;
  snap = { ...snap, reveal: { mon, dexNo: dexNoOf(mon.speciesId), level: monLevel(mon), shiny: !!mon.shiny } };
  listeners.forEach((l) => l());
}

/** Actualiza el market cap actual de los tokens de la colección (sube/baja su nivel y el estado debilitado). */
export function updateCollectionCaps(caps: Map<string, number>) {
  let changed = false;
  const collection = snap.collection.map((m) => {
    const now = m.token && caps.get(m.token.address);
    if (!m.token || !now || now === m.token.marketCap) return m;
    changed = true;
    return { ...m, token: { ...m.token, marketCap: now } };
  });
  if (!changed) return;
  snap = { ...snap, collection };
  listeners.forEach((l) => l());
  persist();
}
export const getCollection = () => snap.collection;

const fromServer = (m: ServerMon): CaughtMon => ({ ...m, shiny: m.shiny || undefined });

/** Pone la partida del servidor (Caja y bolsa) como la fuente de verdad. */
export function setServerSave(box: ServerMon[], balls: Record<BallKey, number>) {
  const collection = box.map(fromServer);
  snap = {
    ...snap, collection, balls: { ...START_BALLS, ...balls },
    caught: new Set(collection.map((m) => m.id)), caughtSpecies: new Set(collection.map((m) => m.speciesId)),
  };
  listeners.forEach((l) => l());
  persist();
}
export function setServerBalls(balls: Record<BallKey, number>) {
  snap = { ...snap, balls: { ...START_BALLS, ...balls } };
  listeners.forEach((l) => l());
  persist();
}

/** Suma bolas a la bolsa (tienda, regalo diario). */
export function addBalls(delta: Partial<Record<BallKey, number>>) {
  const balls = { ...snap.balls };
  for (const k of BALL_ORDER) balls[k] += delta[k] ?? 0;
  snap = { ...snap, balls };
  listeners.forEach((l) => l());
  persist();
}
/** Cierra el revelado; si venía de un encuentro recién ganado, además termina el encuentro. */
export function closeReveal() {
  const wasCatch = snap.result === 'caught';
  snap = { ...snap, reveal: null };
  listeners.forEach((l) => l());
  if (wasCatch) endEncounter();
}

/** % de captura para mostrar en el botón Throw (con calidad neutra). */
export function displayChance(): number {
  const spawn = spawnById(snap.activeId);
  if (!spawn) return 0;
  return Math.round(catchChance(baseOf(spawn), snap.ball, 1) * 100);
}
