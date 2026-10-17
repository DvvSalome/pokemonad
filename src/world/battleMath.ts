// Números de combate, portados de research/pokegrass-source/js/cards.js (fighter) y de la tabla de tipos
// (CHART) + nombres de ataque (MOVE_NAME). El original corría el daño en el servidor (lib/battle.js); aquí,
// sin servidor, lo resolvemos en cliente con la misma tabla y stats deterministas por especie. Lo comparten
// las cartas (cardCanvas.ts) y el combate por turnos (battleStore.ts / BattleScreen.tsx).
import type { MonType, Species } from './species';

export const MOVE_NAME: Record<string, string> = {
  Normal: 'Ape In', Fire: 'Burn Rate', Water: 'Liquidity Wave', Grass: 'Green Candle', Electric: 'Pump Shock',
  Ice: 'Frozen Chart', Fighting: 'Diamond Fist', Poison: 'Toxic FUD', Flying: 'To The Moon', Psychic: 'Mind Alpha',
  Bug: 'Bug Bounty', Rock: 'Hard Floor', Ghost: 'Rug Pull', Dragon: 'Whale Roar', Dark: 'Dump It', Steel: 'Cold Wallet', Fairy: 'Airdrop',
};

/** Tabla de efectividad de tipos (idéntica a cards.js). CHART[atacante][defensor] = multiplicador. */
export const CHART: Record<string, Record<string, number>> = {
  Normal: { Rock: 0.5, Ghost: 0.5, Steel: 0.5 }, Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Rock: 2, Dragon: 0.5 }, Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Electric: { Water: 2, Grass: 0.5, Electric: 0.5, Flying: 2, Dragon: 0.5 }, Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0.5, Dark: 2, Steel: 2, Fairy: 0.5 }, Poison: { Grass: 2, Poison: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0.5, Fairy: 2 },
  Flying: { Grass: 2, Electric: 0.5, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 }, Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0.5, Steel: 0.5 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 }, Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 }, Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 }, Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 }, Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

export const effectiveness = (moveType: string, foeType: string): number => CHART[moveType]?.[foeType] ?? 1;
export const weakTo = (type: string) => Object.keys(CHART).filter((t) => CHART[t]?.[type] === 2);
export const resists = (type: string) => Object.keys(CHART).filter((t) => CHART[t]?.[type] === 0.5 || CHART[t]?.[type] === 0);

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Stats { maxHp: number; atk: number; def: number; spd: number }

/** Stats deterministas de una especie a un nivel dado (misma fórmula que fighter() de cards.js). */
export function fighter(id: string, level: number): Stats {
  const R = rng(hash32(`base-${id}`));
  const w = { hp: 0.8 + R() * 0.5, atk: 0.8 + R() * 0.5, def: 0.8 + R() * 0.5, spd: 0.7 + R() * 0.6 };
  const sum = w.hp + w.atk + w.def + w.spd;
  const b = { hp: Math.round((280 * w.hp) / sum), atk: Math.round((280 * w.atk) / sum), def: Math.round((280 * w.def) / sum), spd: Math.round((280 * w.spd) / sum) };
  const L = Math.max(1, Math.min(100, level));
  return { maxHp: Math.round(b.hp * (1 + L / 22)) + 18, atk: Math.round(b.atk * (1 + L / 30)), def: Math.round(b.def * (1 + L / 30)), spd: Math.round(b.spd * (1 + L / 40)) };
}

export interface Move { name: string; type: MonType; power: number }
/** Los dos ataques de un monstruo: uno de su tipo (fuerte) y uno Normal (fiable), igual que en la carta. */
export function movesFor(species: Species): Move[] {
  return [
    { name: MOVE_NAME[species.type] || 'Ape In', type: species.type, power: 34 },
    { name: species.type === 'Normal' ? 'Market Buy' : 'Ape In', type: 'Normal', power: 22 },
  ];
}

/** Daño de un ataque: potencia × (atk/def) × efectividad × pequeña variación, mínimo 1. */
export function damageOf(move: Move, attacker: Stats, defender: Stats, defType: MonType): { dmg: number; eff: number } {
  const eff = effectiveness(move.type, defType);
  if (eff === 0) return { dmg: 0, eff };
  const ratio = attacker.atk / Math.max(20, defender.def);
  const raw = move.power * (0.55 + 0.6 * ratio) * eff * (0.9 + Math.random() * 0.2);
  return { dmg: Math.max(1, Math.round(raw)), eff };
}
