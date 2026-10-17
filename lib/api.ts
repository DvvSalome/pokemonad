// Cliente del servidor del juego (Edge Function `game` en Supabase, ver supabase/functions/game). Todo es un
// POST {action, ...} con la sesión en la cabecera `x-session`. Si el servidor no responde, el juego sigue en
// modo local (lo que había antes del backend): `isOnline()` es lo que miran los stores para elegir camino.
import type { BallKey, SpawnToken, Tier } from '../src/world/species';
import { tServer } from '../src/i18n';

// El fallback apuntaba a un proyecto Supabase viejo que sigue en pie: si VITE_GAME_URL falta en el build,
// el juego arrancaba contra ese servidor sin avisar de nada. Ahora el valor por defecto es el proyecto real.
const GAME_URL = (import.meta.env.VITE_GAME_URL as string | undefined) ?? 'https://cyyetwpqyhoreyyefuda.supabase.co/functions/v1/game';
const SESSION_KEY = 'pg-session-v1';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfterSec?: number) { super(message); }
}

let online = false;
export const isOnline = () => online;
export const setOnline = (v: boolean) => { online = v; };

export function getSession(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
export function setSession(token: string | null) {
  try { if (token) localStorage.setItem(SESSION_KEY, token); else localStorage.removeItem(SESSION_KEY); } catch { /* sin storage */ }
}

export async function call<T>(action: string, body: Record<string, unknown> = {}, timeoutMs = 12_000): Promise<T> {
  const session = getSession();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(GAME_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(session ? { 'x-session': session } : {}) },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = data as { error?: string; code?: string; retryAfterSec?: number };
      const retry = Number(d.retryAfterSec ?? r.headers.get('retry-after'));
      throw new ApiError(tServer(d.error ?? `HTTP ${r.status}`), r.status, d.code, Number.isFinite(retry) && retry > 0 ? retry : undefined);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- respuestas ----------
export interface ServerExtra { id: string; line: string; expiresAt: number; kind: 'lure' | 'safari' | 'summit'; shiny: boolean }
export type HoldTier = 'Ace' | 'Veteran' | 'Champion';
export interface HolderView {
  tier: HoldTier | null; perks: string | null; symbol: string; balance: string | null; checkedAt: number | null;
  next: { tier: HoldTier; min: string } | null;
}
export interface ServerTrainer {
  id: string; name: string; wallet: string | null; balls: Record<BallKey, number>;
  buffs: Partial<Record<'radar' | 'charm' | 'revive', number>>;
  stats: { throws?: number; catches?: number; shinies?: number; disc?: number };
  score: number; weekPoints: number; imported: boolean; extra: ServerExtra[];
  eggsReady?: number; missionsReady?: number; hasRecovery?: boolean;
  holder?: HolderView; refCode?: string | null; referred?: boolean; refs?: number; admin?: boolean;
}
export interface ServerMon {
  id: string; speciesId: string; name: string; tier: Tier; model: string; stage: number; shiny: boolean;
  caughtAt: number; discovered: boolean; token?: SpawnToken & { m0: number; dexNo: number | null };
}
export interface MeResult { trainer: ServerTrainer; box: ServerMon[]; daily: string[]; session?: string }
export interface RouteSpawn {
  address: string; symbol: string; name: string; logo?: string; marketCap: number; liquidityUsd: number;
  createdAt: number; kind: 'new' | 'hot'; dexNo: number | null; catches: number; shiny: boolean;
  tier?: Tier; level?: number;
}
/** Evento global: Monstruo Dorado (uno para todo el servidor; `spot` = índice de lugar del mapa). */
export interface ServerEvent { id: string; kind: 'golden'; line: string; spot: number; jitter: number; endsAt: number; caughtBy: string | null }
export interface RouteResult { w: number; endsAt: number; now: number; spawns: RouteSpawn[]; events?: ServerEvent[]; extra?: ServerExtra[] }
export interface EncounterResult { spawnId: string; foeHp: number; foeMax: number; shiny: boolean; base: number; foeLevel?: number }
export interface ThrowResult {
  caught: boolean; shakes: number; fled: boolean; chance: number; balls: Record<BallKey, number>;
  points?: number; discovered?: boolean; dexNo?: number | null; mon?: ServerMon; egg?: EggKind | null;
}
export interface BattleEvent { side: 'foe' | 'player'; name: string; type: string; dmg: number; eff: number }
export interface BattleMoveResult { events: BattleEvent[]; foeHp: number; pHp: number; result: 'win' | 'lose' | null }
export interface BoardRow { rank: number; name: string; wallet: boolean; points: number; catches: number; disc: number; shinies: number }
export interface FeedRow {
  id: number; at: number; kind: 'catch' | 'discover' | 'evolve'; trainer_name: string | null; token: string | null;
  symbol: string | null; logo: string | null; species: string | null; stage_from: number | null; stage_to: number | null;
  shiny: boolean; mcap: number | null;
}
export type PrizeCat = 'league' | 'arena' | 'discoverer';
export interface PrizeRow {
  id: number; week: number; category: PrizeCat; rank: number; name: string; wallet: string | null; score: number;
  amount: string; symbol: string; status: 'pending' | 'paid'; txHash: string | null; paidAt: number | null;
}
export interface MiniRow { rank: number; name: string; wallet: boolean; points: number }
export interface BoardResult {
  weekEndsAt: number; week: BoardRow[]; allTime: BoardRow[]; feed: FeedRow[]; myRank: number | null;
  arena?: MiniRow[]; discoverers?: MiniRow[]; winners?: PrizeRow[]; prizes?: Record<PrizeCat, string[]>; prizeMinHold?: string; symbol?: string;
}
export interface TokenInfo {
  chainId: number; chainName: string; mainnet: boolean; explorer: string; address: string; symbol: string; decimals: number;
  name: string; buyUrl: string; chartUrl: string; tokenUrl: string; martMode: 'treasury' | 'burn'; treasury: string; dead: string;
  tiers: { tier: HoldTier; min: string; perks: string }[]; prizes: Record<PrizeCat, string[]>; prizeMinHold: string;
  prices: Record<string, string>;
  stats: { burned: string | null; treasuryBalance: string | null; martTotal: string; martPayments: number }; updatedAt: number;
}

// ---------- misiones y huevos ----------
export type EggKind = 'green' | 'blue' | 'gold';
export interface Mission { i: number; k: string; goal: number; p: number; claimed: boolean; arg?: string; text: string; unit?: 'm' }
export interface MissionReward { balls: Partial<Record<BallKey, number>>; points: number }
export interface MissionsResult {
  day: string; week: number; d: Mission[]; w: Mission[]; bonusD: boolean; bonusW: boolean;
  reward: { daily: MissionReward; weekly: MissionReward }; resetD: number; resetW: number;
}
export interface MissionClaimResult { missions: MissionsResult; reward: Partial<Record<BallKey, number>>; points: number; egg: EggKind | null; trainer: ServerTrainer }
export interface EggInfo { id: string; kind: EggKind; name: string; km: number; start: number | null; progress: number; left: number }
export interface EggsResult { walked: number; incubators: number; max: number; eggs: EggInfo[] }
export interface WalkResult { walked: number; counted: number; ready: string[] }
export interface HatchResult extends EggsResult { kind: EggKind; eggName: string; points: number; mon?: ServerMon; trainer: ServerTrainer }
