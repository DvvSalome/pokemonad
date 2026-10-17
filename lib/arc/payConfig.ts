// La red y el token con los que se paga en la Mart. Monad de punta a punta:
//   testnet (ahora): chainId 10143, gas en MON, WMON de testnet como ERC-20 de la tienda.
//   mainnet: VITE_PAY_CHAIN_ID=143 y VITE_PAY_TOKEN=WMON (0x3bd359C1…433A, 18 decimales).
// El servidor es quien manda en precios, tesorería y token (acción `mart`); estos valores solo se usan para
// elegir la red de la wallet y para mostrar algo antes de que responda.
// Parámetros oficiales: https://docs.monad.xyz/developer-essentials/testnets y el índice de Blitz
// https://blitz.devnads.com/resources
import { monad, monadTestnet } from 'viem/chains';
import type { Address, Chain } from 'viem';

const env = import.meta.env as Record<string, string | undefined>;
const chainId = Number(env.VITE_PAY_CHAIN_ID ?? monadTestnet.id);

/** La red en la que la app conecta la wallet (y lee el saldo de gas, en MON). */
export const appChain: Chain = chainId === monad.id ? monad : monadTestnet;

/** WMON de testnet, el wrapped canónico publicado en la doc de Monad. En mainnet es otro contrato. */
const WMON_TESTNET = '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541';
const WMON_MAINNET = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';

export const PAY_DEFAULTS = {
  token: (env.VITE_PAY_TOKEN ?? (appChain.id === monad.id ? WMON_MAINNET : WMON_TESTNET)) as Address,
  decimals: Number(env.VITE_PAY_DECIMALS ?? 18),
  symbol: env.VITE_PAY_SYMBOL ?? 'WMON',
};

/** Donde pedir MON de prueba (solo en testnet). */
export const FAUCET_URL = appChain.testnet ? 'https://faucet.monad.xyz' : null;

export const txUrl = (hash: string) => `${appChain.blockExplorers?.default.url ?? 'https://testnet.monadvision.com'}/tx/${hash}`;
