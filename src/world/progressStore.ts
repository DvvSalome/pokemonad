// El progreso del jugador: experiencia, nivel, monedas y el historial de lo que ha aprendido.
//
// La experiencia sale de saber, no de pasear: cada pregunta bien respondida en el Coliseo Monad da XP (y más
// si va en racha), ganar a un jefe da un premio grande y atrapar a un profesor de campo da su parte. Fallar
// también suma un poco — el juego premia intentarlo, porque la explicación del fallo es parte de la clase.
//
// Las monedas del Mart viven aquí también (antes eran un número suelto en FieldPlay): así cerrar bien una
// pregunta da dinero para bolas, y las bolas llevan a profesores, que dan más lecciones. Un solo bucle.
//
// Todo se guarda en localStorage del navegador. Mismo patrón que el resto de stores: objeto inmutable +
// useSyncExternalStore, sin dependencias.
import { useSyncExternalStore } from 'react';

export interface Activity { t: number; text: string; xp: number; coins: number }

export interface Progress {
  xp: number;
  coins: number;
  correct: number;
  wrong: number;
  bestStreak: number;
  battlesWon: number;
  battlesLost: number;
  catches: number;
  /** Ids de los profesores atrapados: el cuaderno de apuntes del perfil. */
  notes: string[];
  /** Lo último que dio experiencia, lo más reciente primero. */
  log: Activity[];
  since: number;
}

const KEY = 'pg-progress-v1';
const OLD_COINS = 'pg-field-coins';
const START_COINS = 200;

/** Lo que paga cada cosa. Un sitio para equilibrar la economía entera. */
export const REWARD = {
  correct: { xp: 25, coins: 10 },
  /** Extra por cada acierto seguido a partir del segundo, con tope. */
  streakXp: 5, streakCap: 6,
  wrong: { xp: 5, coins: 0 },
  win: { xp: 150, coins: 80 },
  loss: { xp: 20, coins: 0 },
  catch: { xp: 40, coins: 15 },
} as const;

function fresh(): Progress {
  let coins = START_COINS;
  try {
    const old = localStorage.getItem(OLD_COINS);
    if (old != null && Number.isFinite(Number(old))) coins = Number(old);
  } catch { /* sin storage */ }
  return { xp: 0, coins, correct: 0, wrong: 0, bestStreak: 0, battlesWon: 0, battlesLost: 0, catches: 0, notes: [], log: [], since: Date.now() };
}

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...(JSON.parse(raw) as Partial<Progress>) };
  } catch { /* corrupto o sin storage: se empieza de cero */ }
  return fresh();
}

let s: Progress = load();
const listeners = new Set<() => void>();
function commit(next: Progress) {
  s = next;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* vale en memoria */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useProgress = (): Progress => useSyncExternalStore(subscribe, () => s, () => s);
export const getProgress = () => s;

// ---------------------------------------------------------------- niveles

/** XP acumulada necesaria para llegar al nivel n (nivel 1 = 0). Curva suave: 120, 360, 720, 1200… */
export const xpForLevel = (n: number) => 60 * (n - 1) * n;

export function levelOf(xp: number) {
  let lv = 1;
  while (xp >= xpForLevel(lv + 1)) lv++;
  const from = xpForLevel(lv), to = xpForLevel(lv + 1);
  return { level: lv, into: xp - from, need: to - from, pct: (xp - from) / (to - from) };
}

const TITLES: { at: number; es: string; en: string }[] = [
  { at: 1, es: 'Novato del bloque', en: 'Block rookie' },
  { at: 3, es: 'Aprendiz de gas', en: 'Gas apprentice' },
  { at: 5, es: 'Firmante de confianza', en: 'Trusted signer' },
  { at: 8, es: 'Validador junior', en: 'Junior validator' },
  { at: 12, es: 'Ingeniero de paralelismo', en: 'Parallelism engineer' },
  { at: 17, es: 'Maestro del bytecode', en: 'Bytecode master' },
  { at: 23, es: 'Leyenda de Monad', en: 'Monad legend' },
];
export function titleOf(level: number, lang: string) {
  const t = [...TITLES].reverse().find((x) => level >= x.at) ?? TITLES[0];
  return lang === 'es' ? t.es : t.en;
}

// ---------------------------------------------------------------- avisos en pantalla

/** Lo que se reenvía al servidor cuando hay wallet (ver hubSync.ts). */
export type SyncEvent =
  | { type: 'answer'; boss: number; qid: string; ok: boolean }
  | { type: 'battle'; boss: number; win: boolean; name: string }
  | { type: 'catch'; id: string; name: string };
let syncer: ((e: SyncEvent) => void) | null = null;
export const setSyncer = (fn: ((e: SyncEvent) => void) | null) => { syncer = fn; };

/** El servidor manda: sustituye el progreso local por el suyo, sin avisos ni historial nuevo. */
export function hydrate(p: Partial<Progress>) { commit({ ...s, ...p }); }

/** Cola de avisos flotantes ("+25 XP", "¡Nivel 4!"). La pinta ProgressToasts. */
export interface Toast { id: number; xp: number; coins: number; text: string; levelUp?: number }
let toasts: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const subscribeToasts = (l: () => void) => { toastListeners.add(l); return () => { toastListeners.delete(l); }; };
export const useToasts = () => useSyncExternalStore(subscribeToasts, () => toasts, () => toasts);
function pushToast(t: Omit<Toast, 'id'>) {
  const toast = { ...t, id: ++toastSeq };
  toasts = [...toasts, toast].slice(-4);
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== toast.id);
    toastListeners.forEach((l) => l());
  }, toast.levelUp ? 3600 : 2200);
}

// ---------------------------------------------------------------- ganar

function gain(xp: number, coins: number, text: string, patch: Partial<Progress> = {}) {
  const before = levelOf(s.xp).level;
  const next: Progress = {
    ...s, ...patch,
    xp: s.xp + xp,
    coins: s.coins + coins,
    log: [{ t: Date.now(), text, xp, coins }, ...s.log].slice(0, 12),
  };
  commit(next);
  const after = levelOf(next.xp).level;
  pushToast({ xp, coins, text, levelUp: after > before ? after : undefined });
}

/** Una pregunta del coliseo respondida. `streak` = aciertos seguidos contando esta. */
export function gainAnswer(ok: boolean, streak: number, es: boolean, meta?: { boss: number; qid: string }) {
  if (meta) syncer?.({ type: 'answer', boss: meta.boss, qid: meta.qid, ok });
  if (ok) {
    const bonus = Math.min(REWARD.streakCap, Math.max(0, streak - 1)) * REWARD.streakXp;
    gain(REWARD.correct.xp + bonus, REWARD.correct.coins,
      es ? (bonus ? `Respuesta correcta · racha ×${streak}` : 'Respuesta correcta') : (bonus ? `Correct answer · streak ×${streak}` : 'Correct answer'),
      { correct: s.correct + 1, bestStreak: Math.max(s.bestStreak, streak) });
  } else {
    gain(REWARD.wrong.xp, REWARD.wrong.coins, es ? 'Fallo, pero aprendiste algo' : 'Missed it, but learned something', { wrong: s.wrong + 1 });
  }
}

export function gainBattle(win: boolean, boss: string, es: boolean, bossId = 0) {
  syncer?.({ type: 'battle', boss: bossId, win, name: boss });
  if (win) gain(REWARD.win.xp, REWARD.win.coins, es ? `Derrotaste a ${boss}` : `Defeated ${boss}`, { battlesWon: s.battlesWon + 1 });
  else gain(REWARD.loss.xp, REWARD.loss.coins, es ? `Combate contra ${boss}` : `Fought ${boss}`, { battlesLost: s.battlesLost + 1 });
}

export function gainCatch(id: string, name: string, es: boolean) {
  if (s.notes.includes(id)) return;
  syncer?.({ type: 'catch', id, name });
  syncer?.({ type: 'catch', id, name });
  gain(REWARD.catch.xp, REWARD.catch.coins, es ? `Atrapaste a ${name}` : `Caught ${name}`, { catches: s.catches + 1, notes: [...s.notes, id] });
}

/** Gastar en el Mart. Devuelve false si no alcanza. */
export function spend(cost: number): boolean {
  if (s.coins < cost) return false;
  commit({ ...s, coins: s.coins - cost });
  return true;
}
