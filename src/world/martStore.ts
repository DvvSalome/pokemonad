// La PokeGrass Mart y el regalo diario, con el catálogo del original (research/pokegrass-source/api/
// board_view_mart.json). Se paga con un ERC-20 (hoy USDC en Arc Testnet, ver lib/arc/payConfig.ts): el
// jugador firma un `transfer` a la tesorería en su wallet y el servidor lo comprueba en la red antes de
// entregar el objeto. Precios, token y tesorería los dicta el servidor (acción `mart`).
import { useSyncExternalStore } from 'react';
import { formatUnits, type Address, type Hash } from 'viem';
import type { BallKey } from './species';
import { addBalls, setServerBalls } from './captureStore';
import { setServerBuffs, type BuffKey } from './buffs';
import { setServerExtra } from './wildStore';
import { ApiError, call, isOnline, type ServerTrainer } from '../../lib/api';
import { appChain, sendToken, tokenBalance, waitReceipt } from '../../lib/arc/chain';
import { FAUCET_URL } from '../../lib/arc/payConfig';
import { connectForPayment, refreshWalletBalance } from './walletStore';
import { t, tk } from '../i18n';

export type ItemKey = 'grass10' | 'super10' | 'hyper5' | 'hood' | 'radar' | 'lure' | 'charm' | 'revive' | 'safari' | 'summit' | 'egg' | 'goldegg';

export interface MartItem {
  name: string;
  icon: string;
  desc: string;
  balls?: Partial<Record<BallKey, number>>;
  buff?: BuffKey;
  minutes?: number;
  /** Aún no disponible (necesita Legend Summit, que no está portado). */
  soon?: boolean;
  /** Huevo: solo con servidor (se guarda y se incuba allí). */
  egg?: boolean;
}

export const MART: Record<ItemKey, MartItem> = {
  grass10: { name: '10 Grass Balls', icon: 'ball', desc: 'The everyday ball.', balls: { ball: 10 } },
  super10: { name: '10 Super Balls', icon: 'super', desc: '×1.6 catch power.', balls: { super: 10 } },
  hyper5: { name: '5 Hyper Balls', icon: 'hyper', desc: '×2.3 catch power, for Rares and Epics.', balls: { hyper: 5 } },
  hood: { name: 'Hood Ball', icon: 'hood', desc: 'A sure catch on anything but a legendary.', balls: { hood: 1 } },
  radar: { name: 'Rare Radar', icon: '📡', desc: 'Every hidden Rare and Epic shows in the grass for 30 minutes.', buff: 'radar', minutes: 30 },
  lure: { name: 'Lure', icon: '🍯', desc: 'Two rare monsters come to you for 10 minutes. Only you see them.', minutes: 10 },
  charm: { name: 'Shiny Charm', icon: '✨', desc: 'Shiny odds ×4 for one hour.', buff: 'charm', minutes: 60 },
  revive: { name: 'Revive', icon: '💊', desc: 'Your fainted monsters can fight again for 24 hours.', buff: 'revive', minutes: 1440 },
  safari: { name: 'Safari Pass', icon: '🧭', desc: 'Six rare and epic monsters for 5 minutes, plus 10 Super Balls.', balls: { super: 10 }, minutes: 5 },
  summit: { name: 'Summit Pass', icon: '⛰️', desc: 'Opens Legend Summit for 24 hours: up to 6 legendaries wait at the peak (3 at a time). Only you see them.', minutes: 1440 },
  egg: { name: 'Blue Egg', icon: '🥚', desc: 'Walk 3 km to hatch an Uncommon or Rare monster.', egg: true },
  goldegg: { name: 'Gold Egg', icon: '🥇', desc: 'Walk 7 km to hatch a Rare or Epic monster.', egg: true },
};
export const MART_ORDER = Object.keys(MART) as ItemKey[];
export const itemName = (k: ItemKey) => tk(`mart.${k}.name`, MART[k].name);
export const itemDesc = (k: ItemKey) => tk(`mart.${k}.desc`, MART[k].desc);

// ---------- aviso de la última acción (toast) ----------
let notice: { text: string; at: number } | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function say(text: string) { notice = { text, at: Date.now() }; listeners.forEach((l) => l()); }
export const useMartNotice = () => useSyncExternalStore(subscribe, () => notice, () => notice);
export function clearNotice() { notice = null; listeners.forEach((l) => l()); }

/** Con servidor, lo que diga él de la bolsa, los efectos y los salvajes privados. */
export function applyServerTrainer(t: ServerTrainer) {
  setServerBalls(t.balls);
  setServerBuffs(t.buffs);
  setServerExtra(t.extra);
}

// ---------- pago con token ----------
export interface MartInfo {
  chainId: number; chainName: string; explorer: string; token: Address; decimals: number; symbol: string;
  treasury: Address; ready: boolean; prices: Partial<Record<ItemKey, string>>;
}
export type PayPhase = 'idle' | 'connecting' | 'signing' | 'confirming' | 'done' | 'error';
export interface PayState { item: ItemKey | null; phase: PayPhase; msg: string | null; hash: Hash | null; faucet: boolean }

let info: MartInfo | null = null;
let pay: PayState = { item: null, phase: 'idle', msg: null, hash: null, faucet: false };
const setPay = (next: Partial<PayState>) => { pay = { ...pay, ...next }; listeners.forEach((l) => l()); };
export const useMartInfo = () => useSyncExternalStore(subscribe, () => info, () => info);
export const usePay = () => useSyncExternalStore(subscribe, () => pay, () => pay);
export const payBusy = () => pay.phase === 'connecting' || pay.phase === 'signing' || pay.phase === 'confirming';
export function clearPay() { if (!payBusy()) setPay({ item: null, phase: 'idle', msg: null, hash: null, faucet: false }); }

/** Pagos ya enviados cuyo objeto aún no se entregó (p. ej. se cerró la pestaña): se reclaman al volver. */
const PENDING_KEY = 'pg-pay-pending-v1';
type Pending = { item: ItemKey; hash: Hash };
const readPending = (): Pending[] => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } };
const writePending = (p: Pending[]) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* sin storage */ } };
const dropPending = (hash: string) => writePending(readPending().filter((p) => p.hash !== hash));

/** Pide al servidor la red, el token, la tesorería y los precios. */
export async function loadMart(): Promise<MartInfo | null> {
  if (!isOnline()) return info;
  try {
    info = await call<MartInfo>('mart');
    listeners.forEach((l) => l());
    void claimPending();
  } catch { /* se reintenta al volver a abrir la Mart */ }
  return info;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** El servidor aún no ve la transacción (425) o el RPC no respondió (404/502 justo tras enviarla): reintentar. */
const retryable = (e: unknown) => e instanceof ApiError && [404, 425, 502].includes(e.status);

async function claim(item: ItemKey, hash: Hash) {
  for (let i = 0; ; i++) {
    try {
      return await call<{ trainer: ServerTrainer; paid: string; symbol: string }>('buy', { item, txHash: hash }, 20_000);
    } catch (e) {
      if (!retryable(e) || i >= 12) throw e;
      await sleep(2500);
    }
  }
}

let claiming = false;
async function claimPending() {
  if (claiming || payBusy()) return;
  claiming = true;
  try {
    for (const p of readPending()) {
      try {
        const r = await call<{ trainer: ServerTrainer }>('buy', { item: p.item, txHash: p.hash });
        applyServerTrainer(r.trainer);
        dropPending(p.hash);
        say(t('mart.delivered', { item: itemName(p.item) }));
      } catch (e) {
        // 402/404/409: el servidor lo rechaza de forma definitiva (no es pago válido, no existe o ya se usó).
        if (e instanceof ApiError && [402, 404, 409].includes(e.status)) dropPending(p.hash);
      }
    }
  } finally { claiming = false; }
}

type WalletErr = { name?: string; code?: number; shortMessage?: string; message?: string; cause?: WalletErr };
const errText = (e: unknown) => {
  // viem envuelve el rechazo del usuario (4001) dentro de otros errores: se busca en toda la cadena `cause`.
  for (let x = e as WalletErr | undefined, i = 0; x && i < 6; x = x.cause, i++) {
    if (x.name === 'UserRejectedRequestError' || x.code === 4001) return t('mart.errCancelled');
  }
  const x = e as WalletErr;
  if (x?.name === 'WaitForTransactionReceiptTimeoutError') return t('mart.errTimeout');
  return x?.shortMessage ?? x?.message ?? t('mart.errGeneric');
};

/** Compra `key` pagando con el token: conectar → firmar en la wallet → confirmar en la red → entregar. */
export async function buy(key: ItemKey) {
  const it = MART[key];
  if (it.soon || payBusy()) return;
  const where = key === 'lure' || key === 'safari' ? t('mart.whereNear') : key === 'summit' ? t('mart.whereSummit') : it.egg ? t('mart.whereEgg') : '';
  setPay({ item: key, phase: 'connecting', msg: null, hash: null, faucet: false });
  let sent: Hash | null = null;
  try {
    if (!isOnline()) throw new Error(t('mart.errOffline'));
    const m = info ?? (await loadMart());
    if (!m?.ready) throw new Error(t('mart.errNotOpen'));
    if (m.chainId !== appChain.id) throw new Error(t('mart.errChain', { id: m.chainId, chain: appChain.name }));
    const conn = await connectForPayment();
    const q = await call<{ to: Address; token: Address; amount: string }>('buy-check', { item: key });
    const amount = BigInt(q.amount);
    const have = await tokenBalance(q.token, conn.address).catch(() => null);
    if (have !== null && have < amount) {
      setPay({ phase: 'error', faucet: !!FAUCET_URL, msg: t('mart.errFunds', { symbol: m.symbol, have: formatUnits(have, m.decimals), cost: formatUnits(amount, m.decimals) }) });
      return;
    }
    setPay({ phase: 'signing' });
    sent = await sendToken(conn, q.token, q.to, amount);
    writePending([...readPending(), { item: key, hash: sent }]);
    setPay({ phase: 'confirming', hash: sent });
    const rc = await waitReceipt(sent);
    if (rc.status !== 'success') { dropPending(sent); throw new Error(t('mart.errTxFailed')); }
    const r = await claim(key, sent);
    dropPending(sent);
    applyServerTrainer(r.trainer);
    if (it.egg) window.dispatchEvent(new Event('pg:progress'));
    refreshWalletBalance();
    setPay({ phase: 'done', msg: t('mart.paid', { item: itemName(key), paid: r.paid, symbol: r.symbol }) + where });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && sent) dropPending(sent);
    const tail = sent && readPending().some((p) => p.hash === sent) ? t('mart.savedTail') : '';
    setPay({ phase: 'error', msg: errText(e) + tail });
  }
}

/** Precio de un objeto con el símbolo, p. ej. "0.05 USDC". */
export const priceLabel = (m: MartInfo | null, key: ItemKey) => {
  const p = m?.prices[key];
  return p ? `${p} ${m!.symbol}` : '—';
};

// ---------- regalo diario ----------
// Como el original: 10 Grass Balls al día para todos, y +15 Grass y 2 Super conectando la wallet.
const DAILY_KEY = 'pg-daily-v1';
const today = () => new Date().toISOString().slice(0, 10);
interface Daily { base?: string; wallet?: string }
function readDaily(): Daily { try { return JSON.parse(localStorage.getItem(DAILY_KEY) || '{}'); } catch { return {}; } }

export function claimDaily(hasWallet: boolean) {
  if (isOnline()) return; // con servidor el regalo lo da `me` (ver online.ts)
  const d = readDaily(), day = today();
  const got: string[] = [];
  if (d.base !== day) { addBalls({ ball: 10 }); d.base = day; got.push(t('daily.base')); }
  if (hasWallet && d.wallet !== day) { addBalls({ ball: 15, super: 2 }); d.wallet = day; got.push(t('daily.wallet')); }
  if (!got.length) return;
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(d)); } catch { /* sin storage */ }
  say(t('daily.gift', { list: got.join(' · ') }));
}
