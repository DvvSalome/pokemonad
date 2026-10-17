// El estado del Coliseo Monad: la puerta, la elección de jefe y el combate de preguntas.
//
// Mismo patrón que el resto de stores del juego (useSyncExternalStore sobre un objeto mutable, sin
// dependencias) y, a propósito, MISMA ESTRUCTURA que battleStore.ts del combate original:
//
//   · startBattle abre una cortinilla; a mitad de ella (WIPE_SWAP_MS, cuando la pantalla está tapada del
//     todo) la vista pasa del mundo a la arena y empieza la presentación; al acabarla se pregunta.
//   · cada respuesta se reproduce en dos tiempos — 'wind' (el atacante carga y lanza) e 'impact' (llega y
//     resta vida) — para que las barras bajen justo cuando el golpe toca en pantalla y no antes.
//   · el golpe que deja K.O. se alarga con cámara lenta antes de la pantalla final.
//   · endBattle cierra con otra cortinilla y devuelve al jugador al mundo, ya fuera del coliseo.
//
// Lo que cambia respecto al original es la moneda del turno: aquí es una pregunta. Aciertas y pegas, fallas
// y te pegan — y en el fallo se para la acción para explicar por qué, que es lo que convierte perder vida
// en aprender algo.
import { useSyncExternalStore } from 'react';
import { gainAnswer, gainBattle } from '../world/progressStore';
import { getLang } from '../i18n';
import type { Address } from 'viem';
import { BOSSES, bossById, pickQuestions, type Boss, type Question } from './questions';
import { badgesOf, beginAttempt, connect, enrol, mintBadge, onChainReady, type Session } from './monad';
import { camCtl } from '../world/cameraStore';
import {
  ACADEMY, INTRO, WIND_MS, IMPACT_MS, KO_EXTRA_MS, GAP_MS, fx, placeMarks, resetStage,
} from '../world/academyStage';

/** La cortinilla tapa la pantalla por completo en este instante: ahí se cambia de mundo a arena. */
export const WIPE_SWAP_MS = 520;
const INTRO_MS = INTRO.end * 1000;

export type Phase = 'closed' | 'gate' | 'roster' | 'talk' | 'battle';
export type Turn = 'intro' | 'ask' | 'resolve' | 'verdict' | 'over';
export type Side = 'player' | 'boss';

/** El golpe que se está reproduciendo ahora mismo. `by` ataca; el otro lo recibe. */
export interface BattleAnim {
  id: number;
  by: Side;
  /** Respuesta correcta (golpea el jugador) o fallo (golpea el jefe). */
  ok: boolean;
  /** Este golpe deja K.O. al que lo recibe. */
  ko: boolean;
  phase: 'wind' | 'impact';
}

/** Resumen del combate para la pantalla final. */
export interface Recap {
  turns: number; hits: number; misses: number; best: number; timeouts: number;
  /** Preguntas falladas, para el repaso de la pantalla final. */
  study: { q: string; doc: string }[];
}
const NO_RECAP: Recap = { turns: 0, hits: 0, misses: 0, best: 0, timeouts: 0, study: [] };

/** Vidas del jugador. Cada fallo cuesta una. */
export const PLAYER_HP = 5;
/** Segundos por pregunta. Agotarlos cuenta como fallo. */
export const ASK_SECONDS = 30;

export interface BattleState {
  boss: Boss;
  queue: Question[];
  /** Índice de la pregunta en curso dentro de `queue`. */
  i: number;
  bossHp: number;
  playerHp: number;
  turn: Turn;
  /** Opción elegida en la pregunta actual (null = sin responder, −1 = se acabó el tiempo). */
  chosen: number | null;
  /** Segundos que quedan en la pregunta actual. */
  left: number;
  anim: BattleAnim | null;
  recap: Recap;
  /** Racha actual de aciertos seguidos. */
  streak: number;
  win?: boolean;
}

export interface AcademyState {
  phase: Phase;
  /** Qué enseña la escena 3D: el mundo normal o la arena. Cambia a mitad de la cortinilla. */
  view: 'world' | 'arena';
  /** Cuenta de cortinillas: cada cambio de vista la incrementa y la UI reproduce una. */
  wipe: number;
  /** Hay una cortinilla en marcha: no se aceptan más transiciones hasta que acabe. */
  transitioning: boolean;
  /** La salida está en curso: la interfaz del combate se desvanece mientras la cortinilla cierra. */
  closing: boolean;
  /** El jugador está lo bastante cerca del guardián como para hablarle. */
  nearGuard: boolean;
  /** Tutor de la explanada al que se le puede hablar. null = ninguno a distancia. */
  nearTutor: number | null;
  /** El tutor con el que está hablando, antes de entrar a su pelea. */
  talking: number | null;
  address: Address | null;
  /** Verificación on-chain superada (o firmada, en modo demostración). */
  verified: boolean;
  busy: string | null;
  error: string | null;
  /** Hash de la última transacción, para enseñar el enlace al explorador. */
  txHash: string | null;
  /** Bitmap de insignias conseguidas. */
  badges: number;
  battle: BattleState | null;
}

const SAVED_BADGES = 'pg-academy-badges';

function savedBadges(): number {
  try { return Number(localStorage.getItem(SAVED_BADGES) ?? 0) || 0; } catch { return 0; }
}

let s: AcademyState = {
  phase: 'closed', view: 'world', wipe: 0, transitioning: false, closing: false, nearGuard: false,
  nearTutor: null, talking: null,
  address: null, verified: false, busy: null, error: null, txHash: null, badges: savedBadges(), battle: null,
};

const listeners = new Set<() => void>();
function set(next: Partial<AcademyState>) {
  s = { ...s, ...next };
  // La escena 3D lee ACADEMY.active por referencia, sin pasar por React.
  ACADEMY.active = s.view === 'arena';
  listeners.forEach((l) => l());
}
function setBattle(next: Partial<BattleState>) {
  if (!s.battle) return;
  set({ battle: { ...s.battle, ...next } });
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export const useAcademy = (): AcademyState => useSyncExternalStore(subscribe, () => s, () => s);
export const getAcademy = () => s;
/** La escena está mostrando la arena del coliseo. */
export const inAcademyArena = () => s.view === 'arena';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Cada combate/transición tiene su número: los temporizadores de uno ya cerrado no tocan al siguiente. */
let seq = 0;
let animSeq = 0;
let session: Session | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

// ---------------------------------------------------------------- la puerta

export function setNearGuard(near: boolean) {
  if (s.nearGuard !== near) set({ nearGuard: near });
}

export function setNearTutor(id: number | null) {
  if (s.nearTutor !== id) set({ nearTutor: id });
}

/** Abre el diálogo del tutor que está en la explanada. Desde ahí se entra directo a su pelea. */
export function talkTo(bossId: number) {
  if (s.phase !== 'closed' || s.transitioning) return;
  set({ phase: 'talk', talking: bossId, error: null });
}

export function openGate() {
  if (s.phase !== 'closed' && s.phase !== 'talk') return;
  set({ phase: s.verified ? 'roster' : 'gate', talking: null, error: null });
}

/** Cierra la puerta o la selección SIN cortinilla: aún no se ha entrado a la arena. */
export function closeAcademy() {
  if (s.view === 'arena' || s.transitioning) return;
  stopTimer();
  set({ phase: 'closed', talking: null, battle: null, busy: null, error: null });
}

/** Conectar la wallet, pasarla a Monad testnet y matricularse (transacción o firma). */
export async function verifyAndEnter() {
  if (s.busy) return;
  set({ busy: 'Conectando la wallet…', error: null, txHash: null });
  try {
    session = await connect();
    set({ address: session.address, busy: onChainReady ? 'Firmando la matrícula en Monad…' : 'Firmando la verificación…' });
    const res = await enrol(session);
    const chainBadges = await badgesOf(session.address);
    const badges = s.badges | chainBadges;
    try { localStorage.setItem(SAVED_BADGES, String(badges)); } catch { /* sin storage */ }
    set({ verified: true, busy: null, txHash: res.hash ?? null, badges, phase: 'roster' });
  } catch (err) {
    const msg = (err as { shortMessage?: string; message?: string })?.shortMessage
      ?? (err as Error)?.message ?? 'No se pudo verificar la wallet.';
    set({ busy: null, error: msg });
  }
}

/** Entrar sin wallet: el temario completo, sin insignia on-chain. */
export function enterAsGuest() {
  set({ phase: 'roster', verified: false, error: null });
}

// ---------------------------------------------------------------- entrada al combate

/**
 * Arranca un combate: cortinilla, cambio de vista a mitad de ella y presentación. Se puede llamar desde la
 * selección de jefe (viene del mundo) o desde la pantalla final (repetir): en los dos casos la cortinilla
 * tapa el cambio, así que la arena nunca "salta" a la vista.
 */
export function startBattle(bossId: number) {
  if (s.transitioning) return;
  const boss = bossById(bossId);
  const my = ++seq;
  stopTimer();
  set({ wipe: s.wipe + 1, transitioning: true, closing: false, error: null, txHash: null });

  setTimeout(() => {
    if (seq !== my) return;
    const queue = pickQuestions(boss, boss.hp + PLAYER_HP - 1, (Date.now() / 1000) | 0);
    resetStage();
    placeMarks();
    fx.bossKey = boss.key;
    fx.height.boss = boss.height;
    camCtl.cut = true;
    set({
      phase: 'battle', view: 'arena', transitioning: false, talking: null,
      battle: {
        boss, queue, i: 0, bossHp: boss.hp, playerHp: PLAYER_HP, turn: 'intro', chosen: null,
        left: ASK_SECONDS, anim: null, recap: NO_RECAP, streak: 0,
      },
    });
  }, WIPE_SWAP_MS);

  setTimeout(() => {
    if (seq !== my || s.battle?.turn !== 'intro') return;
    setBattle({ turn: 'ask', left: ASK_SECONDS });
    tick();
  }, WIPE_SWAP_MS + INTRO_MS);

  // La matrícula ya está hecha. Este intento queda escrito en Monad sin frenar la cortinilla.
  if (session) void beginAttempt(session, boss.id).catch(() => { /* la pelea no depende de que la firma salga */ });
}

function tick() {
  stopTimer();
  timer = setInterval(() => {
    const b = s.battle;
    if (!b || b.turn !== 'ask') return;
    const left = b.left - 1;
    if (left > 0) { setBattle({ left }); return; }
    // Se acabó el tiempo: cuenta como fallo, con su explicación.
    answer(-1);
  }, 1000);
}

// ---------------------------------------------------------------- un turno

/** Responde la pregunta en curso. `choice` −1 = se acabó el tiempo. */
export function answer(choice: number) {
  const b = s.battle;
  if (!b || b.turn !== 'ask') return;
  const ok = choice === b.queue[b.i].answer;
  stopTimer();
  void resolveTurn(choice, ok);
}

/** Reproduce el golpe en sus dos tiempos. La vida se resta justo en el impacto. */
async function resolveTurn(choice: number, ok: boolean) {
  const my = seq;
  const b0 = s.battle!;
  const ko = ok ? b0.bossHp - 1 <= 0 : b0.playerHp - 1 <= 0;
  const r = b0.recap;
  setBattle({
    turn: 'resolve', chosen: choice,
    anim: { id: ++animSeq, by: ok ? 'player' : 'boss', ok, ko, phase: 'wind' },
    recap: { ...r, turns: r.turns + 1, timeouts: r.timeouts + (choice === -1 ? 1 : 0) },
  });

  await wait(WIND_MS);
  if (seq !== my || !s.battle) return;

  // Impacto: aquí baja la vida, con la pausa de impacto, la sacudida y, si es el último, cámara lenta.
  const b = s.battle;
  const streak = ok ? b.streak + 1 : 0;
  if (ok) {
    fx.shake = Math.max(fx.shake, ko ? 0.75 : 0.45);
    fx.freeze = ko ? 0.18 : 0.07;
  } else {
    fx.shake = Math.max(fx.shake, ko ? 0.8 : 0.7);
    fx.freeze = ko ? 0.18 : 0.09;
  }
  if (ko) { fx.kick = 1; fx.slow = 1.5; }
  const q = b.queue[b.i];
  // La experiencia llega con el golpe, no con el clic: el aviso "+25 XP" sale cuando la vida baja.
  gainAnswer(ok, streak, getLang() === 'es', { boss: b.boss.id, qid: `${b.boss.id}:${qHash(q.q)}` });
  setBattle({
    anim: { ...b.anim!, phase: 'impact' },
    bossHp: ok ? Math.max(0, b.bossHp - 1) : b.bossHp,
    playerHp: ok ? b.playerHp : Math.max(0, b.playerHp - 1),
    streak,
    recap: {
      ...b.recap,
      hits: b.recap.hits + (ok ? 1 : 0),
      misses: b.recap.misses + (ok ? 0 : 1),
      best: Math.max(b.recap.best, streak),
      study: ok ? b.recap.study : [...b.recap.study, { q: q.q, doc: q.doc }].slice(-4),
    },
  });

  await wait(IMPACT_MS + (ko ? KO_EXTRA_MS : 0));
  if (seq !== my || !s.battle) return;

  if (ko) { finish(ok); return; }
  setBattle({ anim: null, turn: 'verdict' });
  await wait(GAP_MS);
}

/** Pasa al siguiente turno (lo llama el botón "siguiente ronda" del panel de respuesta). */
export function nextTurn() {
  const b = s.battle;
  if (!b || b.turn !== 'verdict') return;
  const i = b.i + 1;
  // Si se acaban las preguntas sin K.O., gana quien tenga más vida (el empate es del jugador).
  if (i >= b.queue.length) { finish(b.bossHp <= b.playerHp); return; }
  setBattle({ i, turn: 'ask', chosen: null, left: ASK_SECONDS, anim: null });
  tick();
}

/** Id estable de una pregunta: hash corto de su enunciado (no tienen id propio). */
function qHash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function finish(win: boolean) {
  stopTimer();
  const b = s.battle!;
  setBattle({ turn: 'over', win, anim: null });
  gainBattle(win, b.boss.name, getLang() === 'es', b.boss.id);
  if (win) {
    const badges = s.badges | (1 << b.boss.id);
    try { localStorage.setItem(SAVED_BADGES, String(badges)); } catch { /* sin storage */ }
    set({ badges });
  }
}

// ---------------------------------------------------------------- salida del combate

/**
 * Cierra el combate con otra cortinilla y devuelve la escena al mundo. A mitad de ella la vista vuelve
 * al mundo y la cámara corta a donde estaba el jugador: justo fuera del portón, porque durante el duelo
 * su posición real no se tocó (el avatar solo se dibuja en su marca, ver Player.tsx).
 *
 * `next`: a dónde vuelve la interfaz — 'closed' (a explorar) o 'roster' (a elegir otro jefe).
 */
export function endBattle(next: 'closed' | 'roster' = 'closed') {
  if (s.view !== 'arena' || s.transitioning) return;
  const my = ++seq;
  stopTimer();
  set({ closing: true, transitioning: true, wipe: s.wipe + 1 });
  setTimeout(() => {
    if (seq !== my) return;
    fx.bossKey = null;
    resetStage();
    camCtl.cut = true;
    set({ phase: next, view: 'world', battle: null, closing: false, transitioning: false, error: null });
  }, WIPE_SWAP_MS);
}

/** Acuña la insignia de la victoria. Sin contrato desplegado lo dice y no cobra nada. */
export async function claimBadge() {
  const b = s.battle;
  if (!b || !b.win || s.busy) return;
  if (!session) { set({ error: 'Conecta la wallet para acuñar la insignia.' }); return; }
  set({ busy: 'Acuñando la insignia en Monad…', error: null });
  try {
    const score = Math.round((b.recap.hits / Math.max(1, b.recap.hits + b.recap.misses)) * 100);
    const hash = await mintBadge(session, b.boss.id, score);
    set({ busy: null, txHash: hash });
  } catch (err) {
    const msg = (err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? 'No se pudo acuñar.';
    set({ busy: null, error: msg });
  }
}

export const hasBadge = (id: number) => (s.badges & (1 << id)) !== 0;
export const totalBadges = () => BOSSES.filter((b) => hasBadge(b.id)).length;
