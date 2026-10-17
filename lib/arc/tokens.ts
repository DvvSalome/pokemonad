// Feed de tokens de Monad: de dónde salen los monstruos salvajes.
//
// Dos fuentes, ambas públicas y sin API key (verificadas en vivo contra Arc):
//   · GeckoTerminal /networks/arc/new_pools — el feed de lanzamientos NUEVOS. Es la fuente de descubrimiento:
//     DexScreener no tiene endpoint de "pares nuevos por cadena" (sus feeds de novedades son multi-cadena y
//     traen casi nada de Arc), así que para "qué acaba de nacer" esta es la buena.
//   · DexScreener /tokens/v1/arc/{address} — detalle por token (precio, mcap, liquidez, logo, redes).
//
// Nota de datos importante: en tokens recién lanzados `market_cap_usd` suele venir null (no hay supply
// circulante calculado todavía) pero `fdv_usd` sí. Como la evolución del monstruo depende del tamaño del
// token, usamos market cap y caemos a FDV cuando falta — si no, todo lanzamiento nuevo valdría 0.
//
// Límites de tasa: GeckoTerminal ~30 rpm, DexScreener 60 rpm, compartidos por IP. En producción esto debe
// ir por un backend propio con caché; si cada jugador pega directo, se quema la cuota enseguida.

export interface ArcToken {
  /** Dirección del contrato, en minúsculas: es la identidad del monstruo (ver tokenSpecies.ts). */
  address: string;
  name: string;
  symbol: string;
  /** Capitalización en USD. Cae a FDV cuando el market cap no está calculado (habitual en lanzamientos). */
  marketCap: number;
  priceUsd: number;
  /** Liquidez del pool en USD: sirve para descartar tokens vacíos/scam. */
  liquidityUsd: number;
  /** Cuándo nació el pool (ms). Un token recién lanzado = monstruo recién aparecido. */
  createdAt: number;
  /** Logo del token, si la fuente lo trae: el original lo usa para repintar al monstruo. */
  imageUrl?: string;
}

const GT = 'https://api.geckoterminal.com/api/v2';
const DS = 'https://api.dexscreener.com';
const GT_HEADERS = { Accept: 'application/json;version=20230302' };

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

interface GtPool {
  attributes: {
    name?: string;
    base_token_price_usd?: string;
    fdv_usd?: string;
    market_cap_usd?: string | null;
    reserve_in_usd?: string;
    pool_created_at?: string;
  };
  relationships?: { base_token?: { data?: { id?: string } } };
}

interface GtToken { id?: string; attributes?: { image_url?: string | null } }

/** "arc_0xabc…" → "0xabc…" */
const addrFromGtId = (id?: string): string => (id ?? '').split('_').pop()?.toLowerCase() ?? '';

/** El nombre del pool viene como "SÍMBOLO / USDC 1%": nos quedamos con el símbolo del token base. */
const symbolFromPoolName = (name?: string): string => (name ?? '').split('/')[0]?.trim() ?? '';

/**
 * Lanzamientos más recientes en Arc. `minLiquidityUsd` filtra pools vacíos: sin algo de liquidez el token
 * no tiene precio real y como monstruo sería ruido.
 */
export async function fetchNewArcTokens({
  pages = 1,
  minLiquidityUsd = 500,
}: { pages?: number; minLiquidityUsd?: number } = {}): Promise<ArcToken[]> {
  const out: ArcToken[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= pages; page++) {
    const res = await fetch(`${GT}/networks/${WORLD_CHAIN}/new_pools?page=${page}&include=base_token`, { headers: GT_HEADERS });
    if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
    const json = (await res.json()) as { data?: GtPool[]; included?: GtToken[] };
    const logos = new Map<string, string>();
    for (const t of json.included ?? []) {
      const img = t.attributes?.image_url;
      if (img && img !== 'missing.png') logos.set(addrFromGtId(t.id), img);
    }

    for (const pool of json.data ?? []) {
      const a = pool.attributes ?? {};
      const address = addrFromGtId(pool.relationships?.base_token?.data?.id);
      if (!address || address === WMON || seen.has(address)) continue;

      const liquidityUsd = num(a.reserve_in_usd);
      if (liquidityUsd < minLiquidityUsd) continue;

      // market cap real si existe; si no, FDV (lo normal en un token recién lanzado).
      const marketCap = num(a.market_cap_usd) || num(a.fdv_usd);
      const symbol = symbolFromPoolName(a.name);

      seen.add(address);
      out.push({
        address,
        name: symbol,
        symbol,
        marketCap,
        priceUsd: num(a.base_token_price_usd),
        liquidityUsd,
        createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : Date.now(),
        imageUrl: logos.get(address),
      });
    }
  }

  return out;
}

interface DsPair {
  chainId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

/** Tamaño del token: market cap, si falta FDV, y si tampoco hay, la liquidez del pool. */
const capOf = (p: DsPair): number => p.marketCap || p.fdv || p.liquidity?.usd || 0;

/** Cadena de los salvajes en DexScreener y GeckoTerminal, y el WMON de mainnet (no es un monstruo). */
export const WORLD_CHAIN = 'monad';
export const WMON = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';

/**
 * Los tokens de Arc que lista DexScreener. No hay un endpoint "todos los tokens de una cadena": se juntan
 * los pools contra USDC (los 30 de más liquidez) y unas búsquedas, deduplicados por dirección del token.
 */
export async function fetchDexArcTokens({ minLiquidityUsd = 500 } = {}): Promise<ArcToken[]> {
  const urls = [
    `${DS}/token-pairs/v1/${WORLD_CHAIN}/${WMON}`,
    ...['monad', 'monad mon', 'monad wmon'].map((q) => `${DS}/latest/dex/search?q=${encodeURIComponent(q)}`),
  ];
  const lists = await Promise.all(urls.map((u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  const byToken = new Map<string, DsPair>();
  for (const j of lists) {
    for (const p of ((Array.isArray(j) ? j : j?.pairs) ?? []) as DsPair[]) {
      if (p.chainId && p.chainId !== WORLD_CHAIN) continue;
      const flip = p.baseToken?.address?.toLowerCase() === WMON;
      const tok = flip ? p.quoteToken : p.baseToken;
      const addr = tok?.address?.toLowerCase();
      if (!addr || addr === WMON || !/^0x[0-9a-f]{40}$/.test(addr)) continue;
      const prev = byToken.get(addr);
      if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) byToken.set(addr, { ...p, baseToken: tok });
    }
  }
  return [...byToken.entries()]
    .map(([address, p]) => ({
      address,
      name: p.baseToken?.name ?? p.baseToken?.symbol ?? '',
      symbol: p.baseToken?.symbol ?? '',
      marketCap: capOf(p),
      priceUsd: num(p.priceUsd),
      liquidityUsd: p.liquidity?.usd ?? 0,
      createdAt: p.pairCreatedAt ?? Date.now(),
      imageUrl: p.info?.imageUrl,
    }))
    .filter((t) => t.liquidityUsd >= minLiquidityUsd && t.symbol);
}

/**
 * Detalle de un token concreto (precio, mcap, liquidez, logo). Un token puede tener varios pools: nos
 * quedamos con el de más liquidez, que es el que marca el precio de referencia.
 */
export async function fetchArcToken(address: string): Promise<ArcToken | null> {
  const res = await fetch(`${DS}/tokens/v1/${WORLD_CHAIN}/${address}`);
  if (!res.ok) return null;
  const pairs = (await res.json()) as DsPair[];
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
  const base = best.baseToken ?? {};
  return {
    address: (base.address ?? address).toLowerCase(),
    name: base.name ?? base.symbol ?? '',
    symbol: base.symbol ?? '',
    marketCap: capOf(best),
    priceUsd: num(best.priceUsd),
    liquidityUsd: best.liquidity?.usd ?? 0,
    createdAt: best.pairCreatedAt ?? Date.now(),
    imageUrl: best.info?.imageUrl,
  };
}

/** Varios tokens de una (DexScreener acepta hasta 30 direcciones separadas por coma). */
export async function fetchArcTokens(addresses: string[]): Promise<ArcToken[]> {
  if (addresses.length === 0) return [];
  const res = await fetch(`${DS}/tokens/v1/${WORLD_CHAIN}/${addresses.slice(0, 30).join(',')}`);
  if (!res.ok) return [];
  const pairs = (await res.json()) as DsPair[];

  // Un token puede aparecer en varios pools: nos quedamos con el de más liquidez por dirección.
  const byToken = new Map<string, DsPair>();
  for (const p of pairs) {
    const addr = p.baseToken?.address?.toLowerCase();
    if (!addr) continue;
    const prev = byToken.get(addr);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) byToken.set(addr, p);
  }

  return [...byToken.entries()].map(([address, p]) => ({
    address,
    name: p.baseToken?.name ?? p.baseToken?.symbol ?? '',
    symbol: p.baseToken?.symbol ?? '',
    marketCap: capOf(p),
    priceUsd: num(p.priceUsd),
    liquidityUsd: p.liquidity?.usd ?? 0,
    createdAt: p.pairCreatedAt ?? Date.now(),
    imageUrl: p.info?.imageUrl,
  }));
}
