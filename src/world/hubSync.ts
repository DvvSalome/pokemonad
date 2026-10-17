// Une el progreso local (progressStore) con el servidor y cobra el Mart en MON.
//
// El progreso sigue funcionando sin wallet: todo se guarda en el navegador. Al conectar la wallet y firmar la
// entrada (walletStore → online.ts) la cuenta del servidor pasa a ser de esa dirección y este módulo:
//   1. sube una sola vez lo que había en el navegador (`progress-import`),
//   2. se queda con lo que diga el servidor (xp, monedas, historial, apuntes),
//   3. y reenvía cada respuesta, combate y captura para que el historial quede guardado en Supabase.
// Los fallos del servidor nunca rompen el juego: se queda el cálculo local y se reintenta con el siguiente evento.
//
// Compras: con wallet y servidor, las bolas se entregan desde el servidor (balls del entrenador). Pagar con
// monedas del juego es `coin-buy`; pagar con MON es una transacción al contrato PokeMart (o un envío a la
// tesorería si aún no hay contrato) que el servidor verifica en Monad antes de entregar (`mon-buy`).
import { useSyncExternalStore } from 'react';
import { parseAbi, type Hash } from 'viem';
import { ApiError, call, isOnline, type ServerTrainer } from '../../lib/api';
import { getBalance, waitReceipt } from '../../lib/arc/chain';
import { appChain, FAUCET_URL } from '../../lib/arc/payConfig';
import { getOnline } from './online';
import { applyServerTrainer } from './martStore';
import { connectForPayment, refreshWalletBalance } from './walletStore';
import { getLang } from '../i18n';
import { getProgress, hydrate, setSyncer, type SyncEvent } from './progressStore';

interface ServerProgress {
  xp: number; coins: number; correct: number; wrong: number; best_streak: number; battles_won: number; battles_lost: number;
  catches: number; notes: string[]; badges: number; mon_spent: string;
}
interface ServerHistory { kind: string; text: string; xp: number; coins: number; created_at: string; tx_hash: string | null }
interface View { progress: ServerProgress; history: ServerHistory[]; trainer?: ServerTrainer }

// ---------------------------------------------------------------- estado de la sincronización
export interface SyncState { ready: boolean; address: string | null; badges: number; monSpent: string }
let sync: SyncState = { ready: false, address: null, badges: 0, monSpent: '0' };
const subs = new Set<() => void>();
const setSync = (n: Partial<SyncState>) => { sync = { ...sync, ...n }; subs.forEach((l) => l()); };
const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };
export const useSync = () => useSyncExternalStore(subscribe, () => sync, () => sync);
export const syncReady = () => sync.ready;

function apply(v: Partial<View> & { progress: ServerProgress }) {
  const p = v.progress;
  const patch: Parameters<typeof hydrate>[0] = {
    xp: p.xp, coins: p.coins, correct: p.correct, wrong: p.wrong, bestStreak: p.best_streak,
    battlesWon: p.battles_won, battlesLost: p.battles_lost, catches: p.catches, notes: p.notes,
  };
  if (v.history) patch.log = v.history.map((h) => ({ t: Date.parse(h.created_at), text: h.text, xp: h.xp, coins: h.coins })).slice(0, 12);
  hydrate(patch);
  setSync({ badges: p.badges, monSpent: p.mon_spent });
  if (v.trainer) applyServerTrainer(v.trainer);
}

/** Tras conectar: sube la partida del navegador (la primera vez) y se queda con la del servidor. */
export async function syncFromServer(address: string) {
  if (!isOnline()) return;
  const me = getOnline().trainer;
  if (!me || me.wallet !== address.toLowerCase()) return; // todavía no firmó la entrada
  if (sync.ready && sync.address === address.toLowerCase()) return;
  try {
    const local = getProgress();
    apply(await call<View>('progress-import', { local: { ...local, log: undefined } }));
    setSync({ ready: true, address: address.toLowerCase() });
    void claimPending();
  } catch { /* sin servidor: se sigue en local */ }
}

export function stopSync() { setSync({ ready: false, address: null, badges: 0, monSpent: '0' }); }

// ---------------------------------------------------------------- eventos de juego → servidor
async function push(e: SyncEvent) {
  if (!sync.ready) return;
  const lang = getLang();
  try {
    if (e.type === 'answer') await call('progress-answer', { lang, boss: e.boss, questionId: e.qid, ok: e.ok });
    else if (e.type === 'battle') await call('progress-battle', { lang, boss: e.boss, win: e.win, name: e.name });
    else await call('progress-catch', { lang, id: e.id, name: e.name });
    apply(await call<View>('progress')); // el servidor manda: XP, monedas e historial reales
  } catch { /* 429 (demasiado rápido), 409 (sin combate registrado)…: vale lo local */ }
}
setSyncer((e) => { void push(e); });

// ---------------------------------------------------------------- Mart: monedas y MON
export interface MonItem {
  item: string; onchainId: number; name: string; priceMon: string; priceWei: string; priceCoins: number | null;
}
export interface MonMart { chainId: number; explorer: string; contract: `0x${string}` | null; treasury: `0x${string}` | null; ready: boolean; items: MonItem[] }
let mart: MonMart | null = null;
export async function loadMonMart(): Promise<MonMart | null> {
  if (!isOnline()) return mart;
  try { mart = await call<MonMart>('mon-mart'); subs.forEach((l) => l()); } catch { /* se reintenta al abrir */ }
  return mart;
}
export const useMonMart = () => useSyncExternalStore(subscribe, () => mart, () => mart);

export type PayPhase = 'idle' | 'connecting' | 'signing' | 'confirming' | 'done' | 'error';
export interface PayState { item: string | null; phase: PayPhase; msg: string | null; hash: Hash | null; faucet: boolean; explorer: string | null }
const IDLE: PayState = { item: null, phase: 'idle', msg: null, hash: null, faucet: false, explorer: null };
let pay: PayState = IDLE;
const paySubs = new Set<() => void>();
const setPay = (n: Partial<PayState>) => { pay = { ...pay, ...n }; paySubs.forEach((l) => l()); };
export const usePay = () => useSyncExternalStore((l) => { paySubs.add(l); return () => { paySubs.delete(l); }; }, () => pay, () => pay);
export const payBusy = () => pay.phase === 'connecting' || pay.phase === 'signing' || pay.phase === 'confirming';
export const clearPay = () => { if (!payBusy()) setPay(IDLE); };

const MART_ABI = parseAbi(['function buy(uint8 item, uint8 count) payable returns (uint256)']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (e: unknown) => e instanceof ApiError && [404, 425, 502].includes(e.status);

type WalletErr = { name?: string; code?: number; shortMessage?: string; message?: string; cause?: WalletErr };
function errText(e: unknown, es: boolean) {
  for (let x = e as WalletErr | undefined, i = 0; x && i < 6; x = x.cause, i++) {
    if (x.name === 'UserRejectedRequestError' || x.code === 4001) return es ? 'Cancelaste el pago en la wallet.' : 'You cancelled the payment in your wallet.';
  }
  const x = e as WalletErr;
  return x?.shortMessage ?? x?.message ?? (es ? 'No se pudo completar el pago.' : 'The payment could not be completed.');
}

/** Pagos enviados cuyo objeto aún no se entregó (se cerró la pestaña a medias): se reclaman al volver. */
const PENDING_KEY = 'pg-mon-pending-v1';
type Pending = { item: string; hash: Hash };
const readPending = (): Pending[] => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } };
const writePending = (p: Pending[]) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* sin storage */ } };
const dropPending = (hash: string) => writePending(readPending().filter((p) => p.hash !== hash));

async function claim(item: string, hash: Hash) {
  for (let i = 0; ; i++) {
    try {
      return await call<{ progress: ServerProgress; trainer: ServerTrainer; paid: string; explorer: string }>(
        'mon-buy', { item, count: 1, txHash: hash, lang: getLang() }, 20_000);
    } catch (e) { if (!retryable(e) || i >= 12) throw e; await sleep(2500); }
  }
}

export async function claimPending() {
  if (!sync.ready || payBusy()) return;
  for (const p of readPending()) {
    try { const r = await claim(p.item, p.hash); dropPending(p.hash); apply(r); }
    catch (e) { if (e instanceof ApiError && [402, 404, 409].includes(e.status)) dropPending(p.hash); }
  }
}

/** Compra un objeto del Mart con monedas del juego, desde el servidor. false si no alcanzan o falla. */
export async function buyWithCoins(item: string): Promise<boolean> {
  try {
    const r = await call<{ progress: ServerProgress; trainer: ServerTrainer }>('coin-buy', { item });
    apply({ ...r, ...(await call<View>('progress')) , trainer: r.trainer });
    return true;
  } catch { return false; }
}

/** Compra con MON: conectar → firmar en la wallet → confirmar en Monad → que el servidor lo verifique y entregue. */
export async function buyWithMon(item: string) {
  if (payBusy()) return;
  const es = getLang() === 'es';
  setPay({ ...IDLE, item, phase: 'connecting' });
  let sent: Hash | null = null;
  try {
    // Primero la wallet: firmar la entrada es lo que abre (o recupera) la sesión del servidor.
    const conn = await connectForPayment();
    if (!isOnline()) throw new Error(es ? 'Sin conexión con el servidor del juego.' : 'The game server is offline.');
    const m = (await loadMonMart()) ?? mart;
    if (!m?.ready) throw new Error(es ? 'La tienda de MON aún no está abierta.' : 'The MON store is not open yet.');
    if (m.chainId !== appChain.id) throw new Error(es ? `La tienda cobra en la red ${m.chainId}.` : `The store charges on chain ${m.chainId}.`);
    const it = m.items.find((i) => i.item === item);
    if (!it) throw new Error(es ? 'Ese objeto no está a la venta.' : 'That item is not for sale.');

    await syncFromServer(conn.address);
    const wei = BigInt(it.priceWei);
    const have = await getBalance(conn.address).catch(() => null);
    if (have !== null && have < wei) {
      const h = (Number(have) / 1e18).toFixed(4);
      setPay({ phase: 'error', faucet: !!FAUCET_URL, msg: es ? `Te falta MON: tienes ${h} y cuesta ${it.priceMon}.` : `Not enough MON: you have ${h}, it costs ${it.priceMon}.` });
      return;
    }
    setPay({ phase: 'signing' });
    sent = m.contract
      ? await conn.wallet.writeContract({ account: conn.address, chain: appChain, address: m.contract, abi: MART_ABI, functionName: 'buy', args: [it.onchainId, 1], value: wei })
      : await conn.wallet.sendTransaction({ account: conn.address, chain: appChain, to: m.treasury!, value: wei, kzg: undefined });
    writePending([...readPending(), { item, hash: sent }]);
    setPay({ phase: 'confirming', hash: sent, explorer: `${m.explorer}/tx/${sent}` });
    const rc = await waitReceipt(sent);
    if (rc.status !== 'success') { dropPending(sent); throw new Error(es ? 'La transacción falló en la red.' : 'The transaction failed on-chain.'); }
    const r = await claim(item, sent);
    dropPending(sent);
    apply({ ...r, ...(await call<View>('progress').catch(() => ({}))), trainer: r.trainer, progress: r.progress });
    refreshWalletBalance();
    setPay({ phase: 'done', msg: es ? `¡Pagado! ${it.name} · ${r.paid} MON` : `Paid! ${it.name} · ${r.paid} MON`, explorer: r.explorer });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && sent) dropPending(sent);
    const tail = sent && readPending().some((p) => p.hash === sent) ? (es ? ' Tu pago quedó guardado: se entregará al volver.' : ' Your payment is saved and will be delivered when you return.') : '';
    setPay({ phase: 'error', msg: errText(e, es) + tail });
  }
}
