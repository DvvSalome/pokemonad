// Misiones (3 diarias + 3 semanales por entrenador) y huevos (se incuban caminando), como en el original.
// Todo es puro: recibe el estado guardado en `trainers.missions` / `trainers.eggs` y devuelve el nuevo.
import { CATALOG, hash32, rng, type BallKey, type Tier } from './pokemath.ts';

export type MKind = 'catch' | 'throw' | 'win' | 'walk' | 'rare' | 'type' | 'disc' | 'hatch';
export interface Mission { i: number; k: MKind; goal: number; p: number; claimed: boolean; arg?: string; text: string; unit?: 'm' }
export interface Missions { day: string; week: number; d: Mission[]; w: Mission[]; bonusD: boolean; bonusW: boolean }
export type EggKind = 'green' | 'blue' | 'gold';
export interface Egg { id: string; kind: EggKind; start: number | null; at: number }

type Tpl = { k: MKind; goal: number; text: string; unit?: 'm' };
const DAILY: Tpl[] = [
  { k: 'catch', goal: 5, text: 'Catch 5 monsters' },
  { k: 'throw', goal: 15, text: 'Throw 15 balls' },
  { k: 'win', goal: 2, text: 'Win 2 battles' },
  { k: 'walk', goal: 1000, unit: 'm', text: 'Walk 1 km' },
  { k: 'rare', goal: 1, text: 'Catch a Rare or better' },
  { k: 'type', goal: 2, text: 'Catch 2 {T}-type monsters' },
];
const WEEKLY: Tpl[] = [
  { k: 'catch', goal: 30, text: 'Catch 30 monsters' },
  { k: 'win', goal: 10, text: 'Win 10 battles' },
  { k: 'walk', goal: 10000, unit: 'm', text: 'Walk 10 km' },
  { k: 'disc', goal: 1, text: 'Be the first to catch a new token' },
  { k: 'rare', goal: 5, text: 'Catch 5 Rares or better' },
  { k: 'hatch', goal: 2, text: 'Hatch 2 eggs' },
  { k: 'type', goal: 8, text: 'Catch 8 {T}-type monsters' },
];
export const MISSION_REWARD = {
  daily: { balls: { ball: 5, super: 1 } as Partial<Record<BallKey, number>>, points: 25 },
  weekly: { balls: { super: 5, hyper: 2 } as Partial<Record<BallKey, number>>, points: 100 },
};
/** Tipos con al menos 2 líneas comunes, para que "atrapa N del tipo X" no dependa de una sola especie. */
const TYPES = (() => {
  const n = new Map<string, number>();
  for (const s of CATALOG) if (s.tier === 'Common' || s.tier === 'Uncommon') n.set(s.type, (n.get(s.type) ?? 0) + 1);
  return [...n].filter(([, c]) => c >= 2).map(([t]) => t);
})();

function pick(tpls: Tpl[], seed: string): Mission[] {
  const R = rng(hash32(seed));
  const order = tpls.map((t, i) => ({ t, i, r: R() })).sort((a, b) => a.r - b.r).slice(0, 3).sort((a, b) => a.i - b.i);
  return order.map(({ t }, i) => {
    const arg = t.k === 'type' ? TYPES[Math.floor(R() * TYPES.length)] : undefined;
    return { i, k: t.k, goal: t.goal, p: 0, claimed: false, arg, unit: t.unit, text: t.text.replace('{T}', arg ?? '') };
  });
}

/** Renueva las diarias / semanales si cambió el día o la semana. */
export function rollMissions(m: Partial<Missions> | null, trainerId: string, day: string, week: number): Missions {
  const cur = m && m.d && m.w ? (m as Missions) : null;
  const sameDay = cur?.day === day, sameWeek = cur?.week === week;
  return {
    day, week,
    d: sameDay ? cur!.d : pick(DAILY, `d|${trainerId}|${day}`),
    w: sameWeek ? cur!.w : pick(WEEKLY, `w|${trainerId}|${week}`),
    bonusD: sameDay ? !!cur!.bonusD : false,
    bonusW: sameWeek ? !!cur!.bonusW : false,
  };
}

export interface Progress { k: MKind; n: number; type?: string }
/** Suma progreso a las misiones que encajan (no pasa de la meta). */
export function bump(m: Missions, evs: Progress[]): Missions {
  const add = (x: Mission) => {
    let p = x.p;
    for (const e of evs) if (e.k === x.k && (x.k !== 'type' || e.type === x.arg)) p += e.n;
    return p === x.p ? x : { ...x, p: Math.min(x.goal, p) };
  };
  return { ...m, d: m.d.map(add), w: m.w.map(add) };
}

/** Los eventos de una captura. */
export function catchEvents(tier: Tier, type: string, discovered: boolean): Progress[] {
  const evs: Progress[] = [{ k: 'catch', n: 1 }, { k: 'type', n: 1, type }];
  if (tier === 'Rare' || tier === 'Epic' || tier === 'Legendary') evs.push({ k: 'rare', n: 1 });
  if (discovered) evs.push({ k: 'disc', n: 1 });
  return evs;
}

// ---------- huevos ----------
export const EGG: Record<EggKind, { name: string; km: number; odds: [Tier, number][] }> = {
  green: { name: 'Green Egg', km: 1, odds: [['Common', 0.7], ['Uncommon', 0.3]] },
  blue: { name: 'Blue Egg', km: 3, odds: [['Uncommon', 0.6], ['Rare', 0.4]] },
  gold: { name: 'Gold Egg', km: 7, odds: [['Rare', 0.65], ['Epic', 0.35]] },
};
export const INCUBATORS = 2;
export const EGG_BAG_MAX = 9;
/** Cada cuántas capturas cae un Green Egg. */
export const EGG_EVERY_CATCHES = 15;
/** Metros por segundo que acepta el servidor (corriendo va a ~8.2). */
export const MAX_WALK_SPEED = 9;

export function newEgg(kind: EggKind): Egg {
  return { id: `${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, kind, start: null, at: Date.now() };
}
/** Añade un huevo si cabe en la bolsa (los incubados no cuentan). */
export function giveEgg(eggs: Egg[], kind: EggKind): { eggs: Egg[]; given: boolean } {
  if (eggs.filter((e) => e.start == null).length >= EGG_BAG_MAX) return { eggs, given: false };
  return { eggs: [...eggs, newEgg(kind)], given: true };
}
export function eggView(e: Egg, walked: number) {
  const need = EGG[e.kind].km * 1000;
  const done = e.start == null ? 0 : walked - e.start;
  return { id: e.id, kind: e.kind, name: EGG[e.kind].name, km: EGG[e.kind].km, start: e.start, progress: Math.min(1, done / need), left: Math.max(0, need - done) };
}
export function hatchLine(kind: EggKind): string {
  let r = Math.random(), tier: Tier = EGG[kind].odds[0][0];
  for (const [t, p] of EGG[kind].odds) { if (r < p) { tier = t; break; } r -= p; }
  const pool = CATALOG.filter((s) => s.tier === tier);
  return pool[Math.floor(Math.random() * pool.length)].id;
}
