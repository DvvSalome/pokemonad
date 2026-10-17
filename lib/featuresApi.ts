// Tipos y llamadas de lo añadido para igualar al original (supabase/functions/game/features.ts): equipo,
// gimnasios, arena, combates de equipo, legendarios con horario, mercado de cartas y tokens descubiertos.
import type { BallKey, Tier } from '../src/world/species';
import type { ServerMon } from './api';
import { call } from './api';

export interface DuelUnit {
  id: string; sid: string; name: string; model: string; type: string; level: number; hp: number; max: number;
  shiny: boolean; logo?: string | null; symbol?: string | null;
}
export interface DuelMove { name: string; type: string; power: number; eff: number }
export interface DuelView {
  kind: 'gym' | 'arena'; ref: string; foeName: string; p: DuelUnit[]; f: DuelUnit[]; pi: number; fi: number;
  turns: number; over: null | 'win' | 'lose'; moves: DuelMove[];
}
export interface DuelEvent { side: 'foe' | 'player'; name: string; type: string; dmg: number; eff: number; ko: boolean; next?: string }
export interface DuelEnd {
  result: 'win' | 'lose'; badge?: number | null; reward?: Partial<Record<BallKey, number>> | null; points?: number; note?: string;
  elo?: number; delta?: number; counted?: boolean;
}
export interface DuelMoveResult { events: DuelEvent[]; duel: DuelView; end?: DuelEnd }

export interface GymTeamMon { line: string; name: string; model: string; level: number }
export interface Gym {
  i: number; n: number; leader: string; symbol: string | null; logo: string | null; address: string | null; mcap: number | null;
  type: string; team: GymTeamMon[]; beaten: boolean; locked: boolean; rematchToday: boolean;
  reward: { balls: Partial<Record<BallKey, number>>; points: number };
}
export interface GymsResult {
  gyms: Gym[]; badges: number[]; rematch: { balls: Partial<Record<BallKey, number>>; points: number };
  team: (DuelUnit & { stage: number; tier: Tier })[];
}
export interface ArenaResult {
  elo: number; rank: number; left: number; daily: number;
  opponents: { id: string; name: string; elo: number; badges: number; wallet: boolean; beatenToday: boolean }[];
  top: { rank: number; name: string; elo: number; wallet: boolean }[];
}
export interface LegendsResult {
  now: number; access: boolean; holder: boolean; caughtThis: string | null; bounty: string; symbol: string;
  schedule: { id: string; line: string; name: string; start: number; end: number }[];
  hallOfFame: { name: string; at: number; paid: boolean; tx: string | null }[];
}
export interface Listing {
  id: string; spawnId: string; name: string; tier: Tier; shiny: boolean; stage: number; model: string; speciesId: string;
  token: string | null; symbol: string | null; logo: string | null; price: string; status: 'open' | 'sold' | 'cancelled';
  seller: string | null; mine: boolean; sellerWallet: string; reserved: boolean; reservedByMe: boolean; at: number;
  soldAt: number | null; tx: string | null;
}
export interface MarketResult {
  listings: Listing[]; mine: Listing[]; sold: Listing[]; symbol: string; token: string; decimals: number; chainId: number;
  chainName: string; explorer: string; min: string; max: string; wallet: string | null;
}
export interface MarketQuote { id: string; to: string; token: string; amount: string; price: string; symbol: string; chainId: number; until: number }
export interface DiscoveredToken {
  address: string; symbol: string; name: string; logo: string | null; mcap: number; stage: number; dexNo: number;
  catches: number; line: string; by: string | null;
}

export const api = {
  teamSet: (ids: string[]) => call<{ team: string[] }>('team-set', { ids }),
  gyms: () => call<GymsResult>('gyms'),
  gymStart: (n: number) => call<DuelView>('gym-start', { n }),
  arena: () => call<ArenaResult>('arena'),
  arenaStart: (id: string) => call<DuelView>('arena-start', { id }),
  duel: () => call<{ duel: DuelView | null }>('duel'),
  duelMove: (i: number) => call<DuelMoveResult>('duel-move', { i }),
  duelLeave: () => call<{ ok: true; end?: DuelEnd }>('duel-leave'),
  legends: () => call<LegendsResult>('legends'),
  market: () => call<MarketResult>('market'),
  marketList: (id: string, price: string) => call<{ listing: Listing }>('market-list', { id, price }),
  marketUnlist: (id: string) => call<{ ok: true }>('market-unlist', { id }),
  marketQuote: (id: string) => call<MarketQuote>('market-quote', { id }),
  marketBuy: (id: string, txHash: string) => call<{ ok: true; box: ServerMon[] }>('market-buy', { id, txHash }, 20_000),
  discovered: (offset = 0) => call<{ tokens: DiscoveredToken[]; next: number | null }>('discovered', { offset }),
};
