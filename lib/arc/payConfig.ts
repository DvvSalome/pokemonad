// La red y el token con los que se paga en la Mart. Es lo único que cambia entre probar y producción:
//   testnet (ahora): Arc Testnet 5042002, USDC ERC-20 en 0x3600…0000 con 6 decimales (faucet.circle.com).
//   mainnet (BAGFI): VITE_PAY_CHAIN_ID=5042, VITE_PAY_TOKEN=0x1f9f98b2d7b4ddcd93654a1e20221340cf1f241e,
//                    VITE_PAY_DECIMALS=18, VITE_PAY_SYMBOL=BAGFI (y los PAY_* / TREASURY_ADDRESS del servidor).
// El servidor es quien manda en precios, tesorería y token (acción `mart`); estos valores solo se usan para
// elegir la red de la wallet y para mostrar algo antes de que responda.
import { arc, arcTestnet } from 'viem/chains';
import type { Address, Chain } from 'viem';

const env = import.meta.env as Record<string, string | undefined>;
const chainId = Number(env.VITE_PAY_CHAIN_ID ?? arcTestnet.id);

/** La red en la que la app conecta la wallet (y lee el saldo de gas). */
export const appChain: Chain = chainId === arc.id ? arc : arcTestnet;

export const PAY_DEFAULTS = {
  token: (env.VITE_PAY_TOKEN ?? '0x3600000000000000000000000000000000000000') as Address,
  decimals: Number(env.VITE_PAY_DECIMALS ?? 6),
  symbol: env.VITE_PAY_SYMBOL ?? 'USDC',
};

/** Donde pedir tokens de prueba (solo en testnet). */
export const FAUCET_URL = appChain.testnet ? 'https://faucet.circle.com/' : null;

export const txUrl = (hash: string) => `${appChain.blockExplorers?.default.url ?? 'https://testnet.arcscan.app'}/tx/${hash}`;
