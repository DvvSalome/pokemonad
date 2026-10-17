// Combate por turnos contra el monstruo salvaje (estilo Pokémon), representado en el estadio 3D
// (BattleArena.tsx). Con servidor, él resuelve cada turno; sin conexión, el daño sale aquí de battleMath.ts
// (la misma fórmula). Debilitar al salvaje baja su vida en captureStore, lo que sube la probabilidad de
// captura (weakenFactor). Si lo dejas KO, huye y no se puede atrapar — riesgo/premio.
//
// Flujo: startBattle abre una cortinilla; a mitad de ella la vista pasa al estadio (view = 'arena') y
// empieza la presentación; después se eligen ataques. Cada golpe se reproduce en dos tiempos — 'wind'
// (el atacante carga y lanza) e 'impact' (llega, resta vida) — para que las barras bajen justo cuando el
// golpe toca en pantalla y no antes.
import { useSyncExternalStore } from 'react';
import type { MonType, Species } from './species';
import { fighter, movesFor, damageOf, effectiveness, type Move, type Stats } from './battleMath';
import {
  getActiveId, getFoeHp, getFoeMax, setFoeHp, endEncounter, getCollection,
  monLevel, monFainted, monSpecies, monLook, getEncounterShiny, WILD_LEVEL, type CaughtMon,
} from './captureStore';
import { spawnById } from './wildStore';
import { wildLevelOf } from './tokenSpecies';
import { reviveOn } from './buffs';
import { camCtl } from './cameraStore';
import { INTRO } from './arenaLayout';
import type { PortraitLook } from './portrait';
import { call, isOnline, type BattleMoveResult } from '../../lib/api';
import { t, onLangChange } from '../i18n';

/** Un debilitado (su token cayó por debajo del 35%) solo pelea con Revive activo. */
export const canFight = (m: CaughtMon) => !monFainted(m) || reviveOn();

/** Un monstruo recién atrapado (Lv 5) peleando contra un salvaje de Lv 5 queda muy parejo: le damos ventaja. */
const MIN_PLAYER_LEVEL = WILD_LEVEL + 3;

/** La cortinilla tapa la pantalla por completo en este instante: ahí se cambia de mundo a estadio. */
export const WIPE_SWAP_MS = 520;
/** Presentación en el estadio (barrido de cámara + cartel VS) antes del primer turno. */
const INTRO_MS = INTRO.end * 1000;
/** Carga y lanzamiento del ataque, hasta que toca al rival. */
const WIND_MS = 640;
/** Impacto: reacción del golpeado, número de daño, sacudida. */
const IMPACT_MS = 880;
/** El golpe que deja KO se alarga: cámara lenta y cartel "K.O." antes del final. */
const KO_EXTRA_MS = 1500;
/** Un crítico se queda un poco más en pantalla para que se lea el cartel. */
const CRIT_EXTRA_MS = 260;
const GAP_MS = 180;

export type BattleSide = 'player' | 'foe';

/** El golpe que se está reproduciendo ahora mismo. `by` ataca; el otro lo recibe. */
export interface BattleAnim {
  id: number;
  by: BattleSide;
  name: string;
  type: MonType;
  dmg: number;
  eff: number;
  /** Este golpe deja KO al que lo recibe. */
  ko: boolean;
  /**
   * "¡Crítico!" solo de presentación: la tirada salió en lo alto de la variación de damageOf (no hay
   * críticos en la fórmula ni en el servidor; el daño es el mismo, solo se celebra más).
   */
  crit: boolean;
  /** Fracción de la vida máxima del golpeado que se lleva el golpe (0..1): escala sacudida y pausa. */
  pct: number;
  phase: 'wind' | 'impact';
}

/** Resumen del combate para la pantalla final. */
export interface BattleRecap { turns: number; dealt: number; taken: number; best: number; supers: number; crits: number }
const NO_RECAP: BattleRecap = { turns: 0, dealt: 0, taken: 0, best: 0, supers: 0, crits: 0 };

export interface BattleState {
  active: boolean;
  /** Qué enseña la escena 3D: el mundo normal o el estadio. Cambia a mitad de la cortinilla. */
  view: 'world' | 'arena';
  /** Cuenta de cortinillas: cada cambio de vista la incrementa y la UI reproduce una. */
  wipe: number;
  closing: boolean;
  turn: 'intro' | 'choose' | 'busy' | 'over';
  result: 'win' | 'lose' | 'flee' | null;
  playerSpecies: Species | null;
  foeSpecies: Species | null;
  pModel: string; fModel: string;
  /** Colores de cada combatiente (token + shiny). */
  pLook: PortraitLook; fLook: PortraitLook;
  pLevel: number; fLevel: number;
  pHp: number; pMax: number; pStats: Stats;
  fStats: Stats;
  moves: Move[];
  log: string;
  anim: BattleAnim | null;
  recap: BattleRecap;
}

const ZERO: Stats = { maxHp: 0, atk: 0, def: 0, spd: 0 };
let s: BattleState = {
  active: false, view: 'world', wipe: 0, closing: false, turn: 'choose', result: null,
  playerSpecies: null, foeSpecies: null, pModel: '', fModel: '', pLook: {}, fLook: {}, pLevel: 0, fLevel: WILD_LEVEL,
  pHp: 0, pMax: 0, pStats: ZERO, fStats: ZERO, moves: [], log: '', anim: null, recap: NO_RECAP,
};

const listeners = new Set<() => void>();
function emit() { s = { ...s }; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
/** El texto del narrador se guarda como función para repintarlo si el jugador cambia de idioma a mitad del combate. */
let logFn: (() => string) | null = null;
function say(fn: () => string) { logFn = fn; return fn(); }
onLangChange(() => { if (logFn && s.active) { s = { ...s, log: logFn() }; listeners.forEach((l) => l()); } });
export function useBattle(): BattleState { return useSyncExternalStore(subscribe, () => s, () => s); }
export const isBattleActive = () => s.active;
/** La escena está mostrando el estadio (el jugador y la cámara están allí, no en el mundo). */
export const inArena = () => s.active && s.view === 'arena';
export const getBattle = () => s;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Cada combate tiene su número: los temporizadores de uno ya cerrado no tocan al siguiente. */
let battleSeq = 0;
let animSeq = 0;

/** El monstruo con el que se pelea por defecto: el último atrapado que no esté debilitado. */
export function defaultFighterId(): string | null {
  const ok = getCollection().filter((m) => canFight(m));
  return ok.length ? ok[ok.length - 1].id : null;
}

/** Arranca el combate con un monstruo de la colección contra el salvaje del encuentro. */
export function startBattle(monId: string) {
  if (s.active) return;
  const spawn = spawnById(getActiveId());
  const mon = getCollection().find((m) => m.id === monId);
  const player = mon && monSpecies(mon);
  if (!spawn || !mon || !player || !canFight(mon)) return;
  const pLevel = Math.max(MIN_PLAYER_LEVEL, monLevel(mon));
  const pStats = fighter(player.id, pLevel);
  const fLevel = wildLevelOf(spawn.token?.marketCap ?? 0);
  const fStats = fighter(spawn.species.id, fLevel);
  const my = ++battleSeq;
  s = {
    active: true, view: 'world', wipe: s.wipe + 1, closing: false, turn: 'intro', result: null,
    playerSpecies: player, foeSpecies: spawn.species, pModel: mon.model, fModel: spawn.model, pLook: monLook(mon),
    fLook: { logo: spawn.token?.logo, symbol: spawn.token?.symbol, shiny: getEncounterShiny() }, pLevel, fLevel,
    pHp: pStats.maxHp, pMax: pStats.maxHp, pStats, fStats,
    moves: movesFor(player), log: say(() => t('battle.challenge', { name: spawn.species.name })), anim: null, recap: NO_RECAP,
  };
  listeners.forEach((l) => l());
  setTimeout(() => {
    if (battleSeq !== my || !s.active) return;
    s = { ...s, view: 'arena' };
    camCtl.cut = true;
    emit();
  }, WIPE_SWAP_MS);
  setTimeout(() => {
    if (battleSeq !== my || !s.active || s.turn !== 'intro') return;
    s = { ...s, turn: 'choose', log: say(() => t('battle.whatWill', { name: player.name })) };
    emit();
  }, WIPE_SWAP_MS + INTRO_MS);
  serverBattle = isOnline()
    ? call('battle-start', { monId }).then(() => true).catch((err: Error) => {
      if (battleSeq !== my) return false;
      s = { ...s, turn: 'over', result: 'flee', log: say(() => t('battle.startFail', { msg: err.message })) };
      emit();
      return false;
    })
    : Promise.resolve(true);
}
let serverBattle: Promise<boolean> = Promise.resolve(true);

const effWord = (e: number) => (e === 0 ? t('battle.effNone') : e >= 2 ? t('battle.effSuper') : e <= 0.5 ? t('battle.effWeak') : '');
/** Nombre de quien ataca, fijado al producir el mensaje (la traducción se resuelve al pintarlo). */
const nameOf = (side: BattleSide) => {
  const n = side === 'player' ? s.playerSpecies!.name : s.foeSpecies!.name;
  return side === 'player' ? () => n : () => t('battle.wildName', { name: n });
};

/** El daño medio que daría ese ataque (misma fórmula que damageOf sin la variación): referencia del crítico. */
function meanDamage(by: BattleSide, name: string, eff: number) {
  const sp = by === 'player' ? s.playerSpecies : s.foeSpecies;
  const power = (sp && movesFor(sp).find((m) => m.name === name)?.power) ?? 34;
  const A = by === 'player' ? s.pStats : s.fStats, D = by === 'player' ? s.fStats : s.pStats;
  return power * (0.55 + 0.6 * (A.atk / Math.max(20, D.def))) * eff;
}

/** Reproduce un golpe en sus dos tiempos. `apply` resta la vida justo en el impacto. */
async function playHit(by: BattleSide, name: string, type: MonType, dmg: number, eff: number, apply: () => void) {
  const my = battleSeq;
  const ko = dmg > 0 && (by === 'player' ? getFoeHp() - dmg <= 0 : s.pHp - dmg <= 0);
  const crit = dmg >= 4 && eff > 0 && dmg > meanDamage(by, name, eff) * 1.065;
  const pct = Math.min(1, dmg / Math.max(1, by === 'player' ? getFoeMax() : s.pMax));
  const who = nameOf(by);
  s = { ...s, anim: { id: ++animSeq, by, name, type, dmg, eff, ko, crit, pct, phase: 'wind' }, log: say(() => t('battle.used', { who: who(), move: name })) };
  emit();
  await wait(WIND_MS);
  if (battleSeq !== my || !s.active) return;
  apply();
  const r = s.recap;
  s = {
    ...s, anim: { ...s.anim!, phase: 'impact' },
    recap: by === 'player'
      ? { ...r, dealt: r.dealt + dmg, best: Math.max(r.best, dmg), supers: r.supers + (dmg > 0 && eff >= 2 ? 1 : 0), crits: r.crits + (crit ? 1 : 0) }
      : { ...r, taken: r.taken + dmg },
    log: say(() => `${t('battle.used', { who: who(), move: name })} ${crit ? t('battle.critLog') : ''} ${effWord(eff)}`.replace(/\s+/g, ' ').trim()),
  };
  emit();
  await wait(IMPACT_MS + (ko ? KO_EXTRA_MS : crit ? CRIT_EXTRA_MS : 0));
  if (battleSeq !== my || !s.active) return;
  s = { ...s, anim: null };
  emit();
  await wait(GAP_MS);
}

function finish(result: 'win' | 'lose' | null) {
  if (result === 'win') {
    window.dispatchEvent(new Event('pg:progress'));
    const foe = s.foeSpecies!.name;
    s = { ...s, turn: 'over', result: 'win', log: say(() => t('battle.foeFainted', { name: foe })) };
  } else if (result === 'lose') {
    const me = s.playerSpecies!.name;
    s = { ...s, turn: 'over', result: 'lose', log: say(() => t('battle.cantGoOn', { name: me })) };
  } else {
    const me = s.playerSpecies!.name;
    s = { ...s, turn: 'choose', log: say(() => t('battle.whatWill', { name: me })) };
  }
  emit();
}

/** Con servidor: él resuelve el turno y aquí solo se reproducen sus golpes, uno a uno. */
async function serverTurn(i: number) {
  if (!(await serverBattle)) return;
  let r: BattleMoveResult;
  try {
    r = await call<BattleMoveResult>('battle-move', { i });
  } catch (err) {
    const msg = (err as Error).message;
    s = { ...s, turn: 'choose', log: say(() => t('battle.attackFail', { msg })) };
    emit();
    return;
  }
  const my = battleSeq;
  for (const ev of r.events) {
    // ev.side es quien RECIBE el golpe.
    const by: BattleSide = ev.side === 'foe' ? 'player' : 'foe';
    await playHit(by, ev.name, ev.type as MonType, ev.dmg, ev.eff, () => {
      if (ev.side === 'foe') setFoeHp(getFoeHp() - ev.dmg);
      else s = { ...s, pHp: Math.max(0, s.pHp - ev.dmg) };
    });
    if (battleSeq !== my) return;
  }
  setFoeHp(r.foeHp);
  s = { ...s, pHp: r.pHp };
  finish(r.result === 'win' || r.result === 'lose' ? r.result : null);
}

/** Resuelve un turno: el jugador usa el ataque i; el salvaje contraataca. */
export async function chooseMove(i: number) {
  if (s.turn !== 'choose' || !s.active || !s.foeSpecies || !s.playerSpecies) return;
  const move = s.moves[i];
  if (!move) return;
  const me = s.playerSpecies.name;
  s = { ...s, turn: 'busy', recap: { ...s.recap, turns: s.recap.turns + 1 }, log: say(() => t('battle.go', { name: me })) }; emit();
  if (isOnline()) { await serverTurn(i); return; }

  const my = battleSeq;
  const foeType = s.foeSpecies.type;
  const playerType = s.playerSpecies.type;
  const playerFast = s.pStats.spd >= s.fStats.spd;

  const playerTurn = async () => {
    const { dmg, eff } = damageOf(move, s.pStats, s.fStats, foeType);
    await playHit('player', move.name, move.type, dmg, eff, () => setFoeHp(Math.max(0, getFoeHp() - dmg)));
    return getFoeHp() <= 0;
  };
  const foeTurn = async () => {
    const fMoves = movesFor(s.foeSpecies!);
    const fm = fMoves[Math.random() < 0.65 ? 0 : 1];
    const { dmg, eff } = damageOf(fm, s.fStats, s.pStats, playerType);
    await playHit('foe', fm.name, fm.type, dmg, eff, () => { s = { ...s, pHp: Math.max(0, s.pHp - dmg) }; });
    return s.pHp <= 0;
  };

  let foeDown = false, playerDown = false;
  if (playerFast) {
    foeDown = await playerTurn();
    if (!foeDown && battleSeq === my) playerDown = await foeTurn();
  } else {
    playerDown = await foeTurn();
    if (!playerDown && battleSeq === my) foeDown = await playerTurn();
  }
  if (battleSeq !== my || !s.active) return;
  finish(foeDown ? 'win' : playerDown ? 'lose' : null);
}

/** Huir del combate: vuelve al encuentro conservando la vida ya restada (sigue debilitado). */
export function fleeBattle() {
  if (!s.active || s.turn === 'busy') return;
  if (isOnline()) void call('battle-leave').catch(() => { /* el servidor solo necesita saber que ya no hay combate */ });
  s = { ...s, turn: 'over', result: 'flee', log: say(() => t('battle.backToBall')) };
  emit();
}

/**
 * Cierra el combate con otra cortinilla y devuelve la escena al mundo. Si el salvaje quedó KO (o el
 * jugador eligió huir del encuentro entero), el encuentro termina al volver.
 */
export function endBattle(opts: { leaveEncounter?: boolean } = {}) {
  if (!s.active || s.closing) return;
  const endIt = s.result === 'win' || !!opts.leaveEncounter;
  const my = battleSeq;
  s = { ...s, closing: true, wipe: s.wipe + 1 };
  emit();
  setTimeout(() => {
    if (battleSeq !== my) return;
    battleSeq++;
    s = { ...s, active: false, closing: false, view: 'world', turn: 'choose', anim: null };
    camCtl.cut = true;
    emit();
    if (endIt) endEncounter();
  }, WIPE_SWAP_MS);
}

// pequeño helper reutilizable por la UI
export { effectiveness };
