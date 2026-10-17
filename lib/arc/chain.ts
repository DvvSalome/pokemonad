// Conexión a Arc (la L1 de Circle), la cadena donde viven los tokens que el juego convierte en monstruos.
//
// viem ya trae la definición oficial de Arc y Arc Testnet (`viem/chains`): chainId, RPC públicos, explorador
// y multicall3. Qué red usa la wallet lo decide payConfig.ts (ahora testnet, para pagar la Mart con USDC de
// prueba). Por eso no hace falta wagmi ni RainbowKit: para "conectar y firmar", EIP-1193 crudo + viem es
// todo, y evita arrastrar TanStack Query y un grafo de conectores a un juego.
//
// OJO con los decimales: el gas en Arc se paga en USDC NATIVO de 18 decimales (formatEther da dólares
// directamente), pero el mismo USDC como ERC-20 (0x3600…0000) es de 6. No mezclar.
import { createPublicClient, createWalletClient, custom, erc20Abi, http, type Address, type Hash, type WalletClient } from 'viem';
import { appChain } from './payConfig';
import { t } from '../../src/i18n';

export { appChain };

/** Cliente de solo lectura: saldos, llamadas a contratos, recibos. No necesita wallet. */
export const publicClient = createPublicClient({ chain: appChain, transport: http() });

/** El proveedor inyectado (MetaMask y compatibles), si existe. */
type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
export function getInjected(): Eip1193 | null {
  const w = window as unknown as { ethereum?: Eip1193 };
  return w.ethereum ?? null;
}

export const hasWallet = () => getInjected() !== null;

export interface Connection {
  address: Address;
  wallet: WalletClient;
}

/**
 * Conecta la wallet y garantiza que esté en la red de la app: primero intenta cambiar de red y, si la red
 * no existe todavía en la wallet (error 4902), la añade con los parámetros EIP-3085 y reintenta.
 */
export async function connectWallet(): Promise<Connection> {
  const injected = getInjected();
  if (!injected) throw new Error(t('wallet.noWallet'));

  const wallet = createWalletClient({ chain: appChain, transport: custom(injected) });
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error(t('wallet.noAccount'));

  try {
    await wallet.switchChain({ id: appChain.id });
  } catch (err) {
    // 4902 = la cadena no está registrada en la wallet todavía.
    const code = (err as { code?: number; cause?: { code?: number } })?.code ?? (err as { cause?: { code?: number } })?.cause?.code;
    if (code === 4902 || /unrecognized|not added|Unrecognized chain/i.test(String((err as Error)?.message))) {
      await wallet.addChain({ chain: appChain });
      await wallet.switchChain({ id: appChain.id });
    } else {
      throw err;
    }
  }

  return { address, wallet };
}

/**
 * Firma un mensaje para probar que la cuenta es del jugador (mismo patrón que el PokeGrass original:
 * sesión por `personal_sign`, sin custodiar nada). El servidor debería emitir el nonce; hasta que exista
 * backend, quien llama pasa el texto.
 */
export async function signIn(conn: Connection, message: string): Promise<string> {
  return conn.wallet.signMessage({ account: conn.address, message });
}

/** Saldo de gas (USDC nativo) en unidades enteras de 18 decimales. */
export async function getBalance(address: Address): Promise<bigint> {
  return publicClient.getBalance({ address });
}

/** Saldo de un ERC-20 en sus unidades mínimas. */
export async function tokenBalance(token: Address, owner: Address): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner], authorizationList: undefined });
}

/** Pide a la wallet un `transfer(to, amount)` del token: la firma el jugador en su wallet. */
export async function sendToken(conn: Connection, token: Address, to: Address, amount: bigint): Promise<Hash> {
  return conn.wallet.writeContract({
    account: conn.address, chain: appChain, address: token, abi: erc20Abi, functionName: 'transfer', args: [to, amount],
  });
}

export const waitReceipt = (hash: Hash) => publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
