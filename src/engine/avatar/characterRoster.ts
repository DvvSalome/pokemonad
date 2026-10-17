// El elenco de personajes jugables — "CUTES Part One" por J-Toastie (poly.pizza), CC-BY 3.0,
// usa una paleta de textura compartida de Kay Lousberg.
import type { Avatar3DConfig } from './shared';

export interface RosterEntry extends Avatar3DConfig {
  emoji: string;
  blurb: string;
}

export const CHARACTER_ROSTER: RosterEntry[] = [
  { id: 'generic-male', nombre: 'Santiago', modelo_url: '/characters/generic-male.glb', escala: 1, emoji: '🙂', blurb: 'Ready for anything' },
  { id: 'generic-female', nombre: 'Alana', modelo_url: '/characters/generic-female.glb', escala: 1, emoji: '🎒', blurb: 'Explorer at heart' },
  { id: 'male-officer', nombre: 'Officer', modelo_url: '/characters/male-officer.glb', escala: 1, emoji: '👮', blurb: 'Keeps the region safe' },
  { id: 'crypto-bro', nombre: 'Degen', modelo_url: '/characters/crypto-bro.glb', escala: 1, emoji: '📈', blurb: 'Bullish on everything' },
  { id: 'santa-claus', nombre: 'Claus', modelo_url: '/characters/santa-claus.glb', escala: 1, emoji: '🎅', blurb: 'Catches monsters, delivers gifts' },
  { id: 'chicken-guy', nombre: 'Cluck', modelo_url: '/characters/chicken-guy.glb', escala: 1, emoji: '🐔', blurb: 'Unhinged energy' },
  { id: 'female-officer', nombre: 'Ranger', modelo_url: '/characters/female-officer.glb', escala: 1, emoji: '👮‍♀️', blurb: 'Never misses a throw' },
  { id: 'citizen-1', nombre: 'Kai', modelo_url: '/characters/citizen-1.glb', escala: 1, emoji: '🧑', blurb: 'Just moved to the region' },
  { id: 'citizen-2', nombre: 'Sofia', modelo_url: '/characters/citizen-2.glb', escala: 1, emoji: '👩', blurb: 'Collects every card' },
  { id: 'citizen-3', nombre: 'Theo', modelo_url: '/characters/citizen-3.glb', escala: 1, emoji: '🧔', blurb: 'Knows every shortcut' },
  { id: 'retail-worker', nombre: 'Clerk', modelo_url: '/characters/retail-worker.glb', escala: 1, emoji: '🛒', blurb: 'Runs the Mart on weekends' },
  { id: 'food-worker', nombre: 'Chef', modelo_url: '/characters/food-worker.glb', escala: 1, emoji: '🍔', blurb: 'Feeds the whole camp' },
  { id: 'prisoner', nombre: 'Rogue', modelo_url: '/characters/prisoner.glb', escala: 1, emoji: '⛓️', blurb: 'Broke out to go catching' },
];
