// Estado de la wallet para la UI, sobre lib/arc/chain.ts. Identifica al jugador, muestra su saldo de gas
// (USDC nativo en la red de payConfig.ts) y, al conectar, firma la entrada en el servidor para que la
// partida quede en esa wallet (online.ts). Los pagos de la Mart salen de esta misma wallet (martStore.ts).
import { useSyncExternalStore } from 'react';
import { formatEther, type Address } from 'viem';
import { connectWallet, getBalance, getInjected, hasWallet, type Connection } from '../../lib/arc/chain';
import { getOnline, signInWallet } from './online';
import { t } from '../i18n';

export interface WalletState {
  status: 'none' | 'idle' | 'connecting' | 'connected' | 'error';
  address: Address | null;
  /** Saldo de gas en USDC (18 decimales en Arc → formatEther da dólares). */
  usdc: string | null;
  error: string | null;
}

let s: WalletState = { status: 'idle', address: null, usdc: null, error: null };
const listeners = new Set<() => void>();
function set(next: Partial<WalletState>) { s = { ...s, ...next }; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export const useWallet = (): WalletState => useSyncExternalStore(subscribe, () => s, () => s);

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function refreshBalance(address: Address) {
  try {
    const wei = await getBalance(address);
    if (s.address === address) set({ usdc: Number(formatEther(wei)).toFixed(2) });
  } catch { /* RPC caído: el saldo simplemente no se muestra */ }
}

let watching = false;
function watchAccounts() {
  const eth = getInjected() as unknown as { on?: (ev: string, cb: (a: string[]) => void) => void } | null;
  if (watching || !eth?.on) return;
  watching = true;
  eth.on('accountsChanged', (accounts) => {
    const next = accounts[0] as Address | undefined;
    if (!next) { set({ status: 'idle', address: null, usdc: null }); return; }
    set({ address: next, usdc: null });
    void refreshBalance(next);
  });
}

export async function connect() {
  if (!hasWallet()) { set({ status: 'none', error: 'No hay wallet instalada (MetaMask, Rabby…).' }); return; }
  if (s.status === 'connecting') return;
  set({ status: 'connecting', error: null });
  try {
    const { address, wallet } = await connectWallet();
    set({ status: 'connected', address, error: null });
    watchAccounts();
    void refreshBalance(address);
    // Si esta sesión ya es de esa wallet no hace falta volver a firmar.
    if (getOnline().trainer?.wallet !== address.toLowerCase()) void signInWallet(address, wallet);
  } catch (err) {
    const msg = (err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? t('wallet.errConnect');
    set({ status: 'error', error: msg });
  }
}

/**
 * Para pagar: conecta (en la red de la app) y se asegura de que la wallet sea la de la cuenta del servidor,
 * pidiendo la firma de entrada si hace falta. Devuelve la conexión para pedir la transacción.
 */
export async function connectForPayment(): Promise<Connection> {
  if (!hasWallet()) throw new Error(t('wallet.needWallet'));
  const conn = await connectWallet();
  set({ status: 'connected', address: conn.address, error: null });
  watchAccounts();
  void refreshBalance(conn.address);
  if (getOnline().trainer?.wallet !== conn.address.toLowerCase()) await signInWallet(conn.address, conn.wallet);
  if (getOnline().trainer?.wallet !== conn.address.toLowerCase()) throw new Error(t('wallet.signFirst'));
  return conn;
}

export function refreshWalletBalance() { if (s.address) void refreshBalance(s.address); }

/** "Desconectar" en EIP-1193 no existe: olvidamos la cuenta en la app. */
export function disconnect() {
  set({ status: 'idle', address: null, usdc: null, error: null });
}
