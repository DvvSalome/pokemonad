// Paleta y "cantidad de fiesta" de la captura según la rareza: un Común brilla blanco-azulado; un
// Legendario o un shiny se llevan más color y más partículas.
import * as THREE from 'three';
import type { Tier } from '../species';

export interface CapStyle {
  /** Color de la luz en la que se convierte el monstruo (rayo, estela, emisivo). */
  glow: THREE.Color;
  /** Acentos para chispas y confeti. */
  accents: THREE.Color[];
  /** Multiplicador de partículas (1 = Común). */
  k: number;
  /** Estrellas que orbitan la bola al atraparlo. */
  orbit: number;
}

const DEF: Record<Tier, { glow: number; accents: number[]; k: number; orbit: number }> = {
  Common: { glow: 0xcfe9ff, accents: [0xffffff, 0x9fd4ff, 0xffe27a], k: 1, orbit: 3 },
  Uncommon: { glow: 0xbff6ee, accents: [0xffffff, 0x8ff0d4, 0x9fd4ff, 0xffe27a], k: 1.15, orbit: 3 },
  Rare: { glow: 0x8fcbff, accents: [0xffffff, 0x5fb2ff, 0x7fe8ff, 0xffe27a], k: 1.4, orbit: 4 },
  Epic: { glow: 0xd6b0ff, accents: [0xffffff, 0xb57cff, 0xff8fe0, 0x7fe8ff], k: 1.7, orbit: 5 },
  Legendary: { glow: 0xffe08a, accents: [0xffffff, 0xffc93a, 0xff9a3a, 0xfff1b0, 0xb57cff], k: 2.1, orbit: 6 },
};
const SHINY = { glow: 0xffc2f2, accents: [0xffffff, 0xff8ce8, 0xffd84a, 0x9ff2ff] };

const cache = new Map<string, CapStyle>();
export function capStyle(tier: Tier, shiny: boolean): CapStyle {
  const key = `${tier}|${shiny ? 1 : 0}`;
  let s = cache.get(key);
  if (s) return s;
  const d = DEF[tier];
  s = {
    glow: new THREE.Color(shiny ? SHINY.glow : d.glow),
    accents: (shiny ? SHINY.accents : d.accents).map((h) => new THREE.Color(h)),
    k: d.k + (shiny ? 0.5 : 0),
    orbit: d.orbit + (shiny ? 1 : 0),
  };
  cache.set(key, s);
  return s;
}
