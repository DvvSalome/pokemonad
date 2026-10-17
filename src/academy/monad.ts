// El lado on-chain del Coliseo Monad: conectar la wallet a Monad testnet, matricularse en la academia y
// acuñar la insignia al derrotar a un jefe.
//
// Va aparte de lib/arc/chain.ts a propósito: aquello habla con Arc (los tokens que pueblan el mundo de
// monstruos) y esto habla con Monad (el módulo educativo). Son dos redes distintas con dos propósitos
// distintos, y mezclarlas en un solo cliente obligaría a adivinar en qué cadena está cada llamada.
//
// MODO DEMOSTRACIÓN: si no hay contrato desplegado (VITE_ACADEMY_CONTRACT sin definir), la verificación
// se hace firmando un mensaje en vez de mandando una transacción. El flujo del juego es idéntico —
// conectar, verificar, entrar— y la insignia se guarda en el navegador. Es lo que permite enseñar el
// módulo completo en una máquina sin fondos de testnet.
import {
  createPublicClient, createWalletClient, custom, http, parseAbi,
  type Address, type Hash, type WalletClient,
} from 'viem';
import { monadTestnet } from 'viem/chains';

export const chain = monadTestnet;
export const explorerTx = (hash: string) => `${chain.blockExplorers?.default.url}/tx/${hash}`;

/** Dirección del AcademyGatekeeper desplegado. Sin ella, el módulo funciona en modo demostración. */
export const ACADEMY_ADDRESS = (import.meta.env.VITE_ACADEMY_CONTRACT as string | undefined)?.trim() as Address | undefined;
export const onChainReady = Boolean(ACADEMY_ADDRESS);

export const ACADEMY_ABI = parseAbi([
  'function enter()',
  'function startAttempt(uint8 boss)',
  'function completeBoss(uint8 boss, uint8 score)',
  'function hasBadge(address student, uint8 boss) view returns (bool)',
  'function profileOf(address student) view returns (uint64 enrolledAt, uint8 badges, uint32 attempts, uint8[3] bestScore)',
]);

export const publicClient = createPublicClient({ chain, transport: http() });

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
export function injected(): Eip1193 | null {
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}
export const hasWallet = () => injected() !== null;

export interface Session {
  address: Address;
  wallet: WalletClient;
}

/**
 * Conecta y deja la wallet en Monad testnet. Si la red no está dada de alta, la añade (EIP-3085) y
 * reintenta: es el camino habitual de un jugador que entra por primera vez desde MetaMask.
 */
export async function connect(): Promise<Session> {
  const provider = injected();
  if (!provider) throw new Error('No hay wallet instalada. Instala MetaMask, Rabby o similar.');
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error('La wallet no devolvió ninguna cuenta.');
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (err) {
    const code = (err as { code?: number; cause?: { code?: number } })?.code
      ?? (err as { cause?: { code?: number } })?.cause?.code;
    if (code === 4902 || /unrecognized|not added/i.test(String((err as Error)?.message))) {
      await wallet.addChain({ chain });
      await wallet.switchChain({ id: chain.id });
    } else throw err;
  }
  return { address, wallet };
}

/** Saldo de MON, para avisar de que hace falta pasar por el faucet. */
export async function balanceOf(address: Address): Promise<bigint> {
  return publicClient.getBalance({ address });
}

/**
 * Matrícula. Con contrato desplegado es una transacción de verdad (y se espera su recibo, que en Monad
 * llega por debajo del segundo); sin él, una firma de mensaje que prueba la posesión de la wallet.
 */
export async function enrol(s: Session): Promise<{ hash?: Hash; signature?: string }> {
  if (!ACADEMY_ADDRESS) {
    const signature = await s.wallet.signMessage({
      account: s.address,
      message: `Coliseo Monad · matrícula de ${s.address} · ${new Date().toISOString().slice(0, 10)}`,
    });
    return { signature };
  }
  const hash = await s.wallet.writeContract({
    account: s.address, chain, address: ACADEMY_ADDRESS, abi: ACADEMY_ABI, functionName: 'enter', args: [],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash };
}

/** Registra que esta pelea empezó. No bloquea el duelo: si la wallet rechaza la firma, la pelea sigue. */
export async function beginAttempt(s: Session, boss: number): Promise<Hash | null> {
  if (!ACADEMY_ADDRESS) return null;
  const hash = await s.wallet.writeContract({
    account: s.address, chain, address: ACADEMY_ADDRESS, abi: ACADEMY_ABI,
    functionName: 'startAttempt', args: [boss],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Dónde pedir MON de prueba. Monad testnet, el faucet oficial de la red. */
export const FAUCET_URL = 'https://faucet.monad.xyz';

/** Acuña la insignia del jefe derrotado. En modo demostración no hace nada y la UI lo dice. */
export async function mintBadge(s: Session, boss: number, score: number): Promise<Hash | null> {
  if (!ACADEMY_ADDRESS) return null;
  const hash = await s.wallet.writeContract({
    account: s.address, chain, address: ACADEMY_ADDRESS, abi: ACADEMY_ABI,
    functionName: 'completeBoss', args: [boss, Math.round(score)],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Insignias ya obtenidas por esa wallet, como bitmap. 0 si no hay contrato o la llamada falla. */
export async function badgesOf(address: Address): Promise<number> {
  if (!ACADEMY_ADDRESS) return 0;
  try {
    // authorizationList: undefined — esta versión de viem lo pide en el tipo de readContract (EIP-7702);
    // es el mismo apaño que ya usa lib/arc/chain.ts.
    const [, badges] = await publicClient.readContract({
      address: ACADEMY_ADDRESS, abi: ACADEMY_ABI, functionName: 'profileOf', args: [address], authorizationList: undefined,
    });
    return Number(badges);
  } catch {
    return 0;
  }
}
