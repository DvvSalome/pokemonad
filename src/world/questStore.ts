// Misiones y huevos (servidor: acciones missions/mission/eggs/walk/incubate/hatch). Los metros caminados se
// miden aquí con la posición real del jugador y se envían cada 15 s; el servidor los limita a lo que da
// tiempo a correr. Sin servidor no hay misiones ni huevos (son progreso que solo tiene sentido guardado).
import { useSyncExternalStore } from 'react';
import {
  call, isOnline, type EggsResult, type HatchResult, type MissionClaimResult, type MissionsResult, type WalkResult,
} from '../../lib/api';
import { BALLS, type BallKey } from './species';
import { applyServerTrainer, say } from './martStore';
import { refreshMe } from './online';
import { playerPos } from './wildStore';
import { t } from '../i18n';

export interface QuestState {
  missions: MissionsResult | null;
  eggs: EggsResult | null;
  hatching: HatchResult | null;
}
let s: QuestState = { missions: null, eggs: null, hatching: null };
const listeners = new Set<() => void>();
function set(next: Partial<QuestState>) { s = { ...s, ...next }; listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useQuests = (): QuestState => useSyncExternalStore(subscribe, () => s, () => s);

/** Misiones listas para cobrar (para el punto rojo del botón). */
export const claimable = (m: MissionsResult | null) => !!m && [...m.d, ...m.w].some((x) => x.p >= x.goal && !x.claimed);
export const eggsReady = (e: EggsResult | null) => !!e && e.eggs.some((x) => x.start != null && x.progress >= 1);

const ballText = (b: Partial<Record<BallKey, number>>) =>
  Object.entries(b).map(([k, v]) => `+${v} ${BALLS[k as BallKey].name}`).join(', ');
const EGG_NAME = { green: 'egg.green', blue: 'egg.blue', gold: 'egg.gold' } as const;

export async function loadMissions() {
  if (!isOnline()) return;
  try { set({ missions: await call<MissionsResult>('missions') }); } catch { /* se reintenta */ }
}
export async function loadEggs() {
  if (!isOnline()) return;
  try { set({ eggs: await call<EggsResult>('eggs') }); } catch { /* se reintenta */ }
}

export async function claimMission(kind: 'd' | 'w', i: number) {
  try {
    const r = await call<MissionClaimResult>('mission', { kind, i });
    applyServerTrainer(r.trainer);
    set({ missions: r.missions });
    say(t('quest.complete', { balls: ballText(r.reward), pts: r.points }) + (r.egg ? t('quest.completeEgg', { egg: t(EGG_NAME[r.egg]) }) : ''));
    if (r.egg) void loadEggs();
  } catch (err) {
    say(t('quest.cantCollect', { msg: (err as Error).message }));
  }
}

export async function incubate(id: string) {
  try { set({ eggs: await call<EggsResult>('incubate', { id }) }); } catch (err) { say((err as Error).message); }
}

export async function hatch(id: string) {
  try {
    const r = await call<HatchResult>('hatch', { id });
    applyServerTrainer(r.trainer);
    set({ eggs: { walked: r.walked, incubators: r.incubators, max: r.max, eggs: r.eggs }, hatching: r });
    void refreshMe();
    void loadMissions();
  } catch (err) {
    say((err as Error).message);
  }
}
export const closeHatch = () => set({ hatching: null });

// ---------- caminar ----------
let enabled = false, last: { x: number; z: number } | null = null, pending = 0, sending = false, lastSend = 0;
let sampler: ReturnType<typeof setInterval> | null = null;
const readySeen = new Set<string>();

async function send() {
  sending = true; lastSend = Date.now();
  const d = Math.round(pending * 10) / 10; pending = 0;
  try {
    const r = await call<WalkResult>('walk', { d });
    if (s.eggs) {
      const eggs = s.eggs.eggs.map((e) => {
        if (e.start == null) return e;
        const need = e.km * 1000, done = r.walked - e.start;
        return { ...e, progress: Math.min(1, done / need), left: Math.max(0, need - done) };
      });
      set({ eggs: { ...s.eggs, walked: r.walked, eggs } });
    }
    const fresh = r.ready.filter((id) => !readySeen.has(id));
    fresh.forEach((id) => readySeen.add(id));
    if (fresh.length) { say(t('quest.eggReady')); void loadEggs(); }
    void loadMissions();
  } catch {
    pending += d;
  } finally {
    sending = false;
  }
}

/** Activa el contador mientras se juega (la cámara del título también mueve playerPos: ahí no cuenta). */
export function setWalking(on: boolean) {
  enabled = on; last = null;
  if (on && !sampler) {
    sampler = setInterval(() => {
      if (!enabled) return;
      const p = { x: playerPos.x, z: playerPos.z };
      // cada 250 ms: más de 3 m es un salto (reaparecer, volar en el mapa), no caminar
      if (last) { const d = Math.hypot(p.x - last.x, p.z - last.z); if (d < 3) pending += d; }
      last = p;
      if (pending >= 5 && Date.now() - lastSend > 15_000 && !sending && isOnline()) void send();
    }, 250);
  }
  if (!on && sampler) { clearInterval(sampler); sampler = null; }
}

// Tras capturar o ganar un combate el progreso cambió en el servidor (captureStore / battleStore lo avisan).
let soon: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('pg:progress', () => {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => { void loadMissions(); void loadEggs(); }, 800);
});
