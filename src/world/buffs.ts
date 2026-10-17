// Efectos temporales de la tienda (Rare Radar, Shiny Charm, Revive) y la suerte shiny, con las cifras del
// original: shiny 1/128, ×4 con el Charm. Sin conexión, el shiny sale del hash de (semilla del jugador +
// ejemplar): estable mientras caminas hacia él, distinto para cada jugador, y lo que es shiny sin Charm
// lo sigue siendo con él (el Charm solo amplía el umbral).
import { useSyncExternalStore } from 'react';
import { hash32 } from './tokenSpecies';

export type BuffKey = 'radar' | 'charm' | 'revive';
type Until = Record<BuffKey, number>;

const KEY = 'pg-buffs-v1';
const SEED_KEY = 'pg-seed';

function load(): Until {
  try { return { radar: 0, charm: 0, revive: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { radar: 0, charm: 0, revive: 0 }; }
}
let until: Until = load();
const listeners = new Set<() => void>();
function emit() {
  until = { ...until };
  try { localStorage.setItem(KEY, JSON.stringify(until)); } catch { /* sin storage: vale en memoria */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useBuffs = (): Until => useSyncExternalStore(subscribe, () => until, () => until);

export const buffOn = (k: BuffKey) => until[k] > Date.now();
export const radarOn = () => buffOn('radar');
export const reviveOn = () => buffOn('revive');

/** Con servidor, los efectos activos son los suyos (se compran allí). */
export function setServerBuffs(b: Partial<Until>) {
  until = { radar: b.radar ?? 0, charm: b.charm ?? 0, revive: b.revive ?? 0 };
  emit();
}

/** Activa (o alarga) un efecto `minutes` minutos. */
export function addBuff(k: BuffKey, minutes: number) {
  until[k] = Math.max(until[k], Date.now()) + minutes * 60_000;
  emit();
}

// Al caducar un efecto la UI y el mundo tienen que enterarse aunque nadie compre nada.
let wasOn = (Object.keys(until) as BuffKey[]).filter(buffOn).join();
setInterval(() => {
  const on = (Object.keys(until) as BuffKey[]).filter(buffOn).join();
  if (on !== wasOn) { wasOn = on; emit(); }
}, 2000);

function seed(): string {
  try {
    let v = localStorage.getItem(SEED_KEY);
    if (!v) { v = Math.random().toString(36).slice(2); localStorage.setItem(SEED_KEY, v); }
    return v;
  } catch { return 'guest'; }
}
const SEED = seed();

export const SHINY_ODDS = 1 / 128;
export const shinyOdds = () => SHINY_ODDS * (buffOn('charm') ? 4 : 1);
// Con servidor el shiny lo decide él (hash secreto) y llega con cada salvaje: el hash local es solo el modo sin red.
const serverShiny = new Map<string, boolean>();
let useServerShiny = false;
export function setServerShiny(entries: [string, boolean][]) {
  useServerShiny = true;
  for (const [id, v] of entries) serverShiny.set(id, v);
}

/** ¿Este ejemplar es shiny para este jugador ahora mismo? */
export function isShiny(spawnId: string): boolean {
  if (useServerShiny) return serverShiny.get(spawnId) ?? false;
  // FNV reparte mal los bits altos con sufijos parecidos: una pasada de mezcla (murmur3 fmix) lo arregla.
  let h = hash32(`${SEED}|${spawnId}`);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296 < shinyOdds();
}
