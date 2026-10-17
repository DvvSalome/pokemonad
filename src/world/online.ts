// La cuenta del jugador en el servidor. Al entrar se crea (o recupera) una sesión de invitado sin pedir nada;
// conectar la wallet la ata a esa dirección con una firma (personal_sign, sin gas), igual que el original.
// La primera vez que un navegador conecta, sube la partida local que tuviera de antes del backend.
// Si el servidor no responde, el juego sigue en local (isOnline() = false) y se reintenta más tarde.
import { useSyncExternalStore } from 'react';
import type { Address, WalletClient } from 'viem';
import { ApiError, call, getSession, setOnline, setSession, type BoardResult, type MeResult, type ServerTrainer } from '../../lib/api';
import { getCollection, setServerSave } from './captureStore';
import { applyServerTrainer, say } from './martStore';
import { refreshWild } from './wildStore';
import { t, tServer } from '../i18n';

export interface OnlineState {
  status: 'connecting' | 'online' | 'offline';
  trainer: ServerTrainer | null;
  error: string | null;
  /** El servidor frenó la entrada (429): `guest` si es el tope de invitados nuevos por red. */
  limited: { guest: boolean; retryAt: number } | null;
}

let s: OnlineState = { status: 'connecting', trainer: null, error: null, limited: null };
const listeners = new Set<() => void>();
function set(next: Partial<OnlineState>) { s = { ...s, ...next }; listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useOnline = (): OnlineState => useSyncExternalStore(subscribe, () => s, () => s);
export const getOnline = () => s;

/** Etapa de cada monstruo de la Caja en el último refresco: si sube, evolucionó. */
let stages = new Map<string, { stage: number; name: string }>();

function apply(r: MeResult) {
  const prev = stages;
  stages = new Map(r.box.map((m) => [m.id, { stage: m.stage, name: m.name }]));
  const evolved = r.box.filter((m) => prev.size && prev.has(m.id) && prev.get(m.id)!.stage < m.stage);
  setServerSave(r.box, r.trainer.balls);
  applyServerTrainer(r.trainer);
  set({ status: 'online', trainer: r.trainer, error: null, limited: null });
  if (evolved.length) say(evolved.map((m) => t('online.evolved', { from: prev.get(m.id)!.name, to: m.name })).join(' '));
  else if (r.daily.length) say(t('daily.gift', { list: r.daily.map(tServer).join(' · ') }));
}

async function login(): Promise<MeResult> {
  if (getSession()) {
    try { return await call<MeResult>('me'); } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
      setSession(null);
    }
  }
  const r = await call<MeResult>('guest');
  setSession(r.session!);
  return r;
}

let booting: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Conecta con el servidor (o reintenta si estaba sin conexión). */
export function bootOnline(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    try {
      let r = await login();
      if (!r.trainer.imported) {
        r = await call<MeResult>('import', { collection: getCollection() });
      }
      setOnline(true);
      apply(r);
      void refreshWild();
      void useStoredReferral(r.trainer);
    } catch (err) {
      setOnline(false);
      let limited: OnlineState['limited'] = null;
      if (err instanceof ApiError && err.status === 429) {
        const wait = Math.min(err.retryAfterSec ?? 60, 86_400);
        limited = { guest: err.code === 'rate_limited_guest', retryAt: Date.now() + wait * 1000 };
        scheduleRetry(wait * 1000 + 1500);
      }
      set({ status: 'offline', error: (err as Error).message, limited });
    } finally {
      booting = null;
    }
  })();
  if (!timer) timer = setInterval(() => { void refreshMe(); }, 120_000);
  return booting;
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRetry(ms: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; void bootOnline(); }, ms);
}

/** Botón "Reintentar": vuelve a probar ya, aunque el servidor pidiera esperar. */
export function retryOnline() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  set({ status: 'connecting' });
  return bootOnline();
}

/** Relee la partida: el market cap de los tokens de la Caja (niveles, debilitados, evoluciones) lo mantiene el tick. */
export async function refreshMe() {
  if (s.status !== 'online') {
    if (s.limited && Date.now() < s.limited.retryAt) return;
    await bootOnline(); return;
  }
  try { apply(await call<MeResult>('me')); } catch { /* se reintenta en el siguiente ciclo */ }
}

/** Ata la wallet a la cuenta: firma un mensaje con nonce del servidor y pasa a la sesión de ese entrenador. */
export async function signInWallet(address: Address, wallet: WalletClient) {
  if (s.status !== 'online') await bootOnline();
  if (s.status !== 'online') return;
  try {
    const { message } = await call<{ message: string }>('nonce', { address });
    const signature = await wallet.signMessage({ account: address, message });
    const r = await call<MeResult>('wallet', { address, signature });
    setSession(r.session!);
    apply(r);
    void refreshWild();
  } catch (err) {
    const msg = (err as { shortMessage?: string })?.shortMessage ?? (err as Error).message;
    say(t('online.signToSave', { msg }));
  }
}

export async function rename(name: string): Promise<string | null> {
  try {
    const r = await call<{ trainer: ServerTrainer }>('rename', { name });
    set({ trainer: r.trainer });
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

export const fetchBoard = () => call<BoardResult>('board');

/** Mezcla lo que devolvió otra acción (nivel de holder, referido…) sin perder campos que solo trae `me`. */
export function setTrainer(t: ServerTrainer) {
  applyServerTrainer(t);
  set({ trainer: { ...s.trainer, ...t } });
}

// ---------- invitaciones ----------
// Un enlace ?ref=CODIGO se guarda al abrir la página y se canjea en cuanto hay sesión (una vez).
const REF_KEY = 'pg-ref-v1';
try {
  const q = new URLSearchParams(location.search).get('ref');
  if (q) localStorage.setItem(REF_KEY, q.slice(0, 16));
} catch { /* sin storage */ }

export const inviteLink = (code: string) => `${location.origin}/?ref=${code}`;

export async function redeemInvite(code: string): Promise<string | null> {
  try {
    const r = await call<{ trainer: ServerTrainer; after: number }>('referral', { code });
    setTrainer(r.trainer);
    say(t('online.inviteOk', { n: r.after }));
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

async function useStoredReferral(t: ServerTrainer) {
  let code: string | null = null;
  try { code = localStorage.getItem(REF_KEY); } catch { /* sin storage */ }
  if (!code) return;
  try { localStorage.removeItem(REF_KEY); } catch { /* sin storage */ }
  if (t.referred || code.toUpperCase() === t.refCode) return;
  await redeemInvite(code);
}

/** Crea (o reemplaza) la clave de recuperación de esta cuenta. El servidor solo guarda su huella: se muestra una vez. */
export async function createRecoveryKey(): Promise<string> {
  const { key } = await call<{ key: string }>('recovery-key');
  if (s.trainer) set({ trainer: { ...s.trainer, hasRecovery: true } });
  return key;
}

/** Entra en la cuenta de esa clave y recarga el juego con ella (la sesión actual se cierra). */
export async function recoverAccount(key: string): Promise<string | null> {
  try {
    const r = await call<MeResult>('recover', { key });
    await call('logout').catch(() => undefined);
    setSession(r.session!);
    location.reload();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
