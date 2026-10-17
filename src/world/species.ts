// Catálogo de especies de PokeGrass, adaptado de research/pokegrass-source/lib/species.js a los modelos
// reales del Ultimate Monsters de Quaternius (CC0). El original tenía formas "bebé" (_Blob) propias que no
// distribuimos; aquí cada línea apunta a su modelo base disponible en el pack. Las líneas alimentan el
// Dex; el subconjunto con GLB copiado a /public/monsters (ver SPAWNS) es el que se instancia en el mundo.
import { PLACES, patchesOf, surfaceY, type Place } from './terrain';

export type MonType =
  | 'Normal' | 'Fire' | 'Water' | 'Grass' | 'Electric' | 'Ice' | 'Fighting' | 'Poison'
  | 'Ground' | 'Flying' | 'Psychic' | 'Bug' | 'Rock' | 'Ghost' | 'Dragon' | 'Dark' | 'Steel' | 'Fairy';
export type Tier = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export type ZoneKey = 'meadow' | 'lake' | 'woods' | 'volcano' | 'peak' | 'ruins';

export interface Species {
  id: string;
  /** Nombre de la primera etapa (el que se muestra en el Dex). */
  name: string;
  type: MonType;
  tier: Tier;
  zone: ZoneKey;
  /**
   * Tasa de captura en la escala clásica 3–255 (255 = casi siempre, 3 = legendario), copiada 1:1 de
   * lib/species.js. Es la base de todos los porcentajes; ver baseCatch() y catchChance().
   */
  rate: number;
  /** true = vuela: se coloca flotando y usa la animación Flying_Idle. */
  flying?: boolean;
}

/** Las líneas de la región, en orden de Dex (las nuevas al final). Los `rate` son los de lib/species.js. */
export const SPECIES_CATALOG: Species[] = [
  // Route 1 Meadow
  { id: 'bird', name: 'Coopip', type: 'Flying', tier: 'Common', zone: 'meadow', rate: 255, flying: true },
  { id: 'chick', name: 'Clucklet', type: 'Normal', tier: 'Common', zone: 'meadow', rate: 255 },
  { id: 'bunny', name: 'Bunnib', type: 'Normal', tier: 'Common', zone: 'meadow', rate: 235 },
  { id: 'bee', name: 'Buzzlet', type: 'Bug', tier: 'Common', zone: 'meadow', rate: 235, flying: true },
  { id: 'cat', name: 'Kitbit', type: 'Normal', tier: 'Uncommon', zone: 'meadow', rate: 190 },
  { id: 'mush', name: 'Sporelet', type: 'Grass', tier: 'Uncommon', zone: 'meadow', rate: 150 },
  { id: 'pink', name: 'Pinkle', type: 'Fairy', tier: 'Rare', zone: 'meadow', rate: 90 },
  // Crystal Lake
  { id: 'fish', name: 'Finnip', type: 'Water', tier: 'Common', zone: 'lake', rate: 255 },
  { id: 'frog', name: 'Tadpip', type: 'Water', tier: 'Uncommon', zone: 'lake', rate: 190 },
  // Whisper Woods
  { id: 'slime', name: 'Goolet', type: 'Poison', tier: 'Common', zone: 'woods', rate: 235 },
  { id: 'glub', name: 'Glubby', type: 'Dark', tier: 'Uncommon', zone: 'woods', rate: 190, flying: true },
  { id: 'monkey', name: 'Monchi', type: 'Fighting', tier: 'Uncommon', zone: 'woods', rate: 150 },
  { id: 'ninja', name: 'Shadlet', type: 'Dark', tier: 'Rare', zone: 'woods', rate: 75 },
  { id: 'ghost', name: 'Wispook', type: 'Ghost', tier: 'Epic', zone: 'woods', rate: 45, flying: true },
  // Ember Crater
  { id: 'golem', name: 'Pebwing', type: 'Rock', tier: 'Common', zone: 'volcano', rate: 225 },
  { id: 'demon', name: 'Impling', type: 'Fire', tier: 'Uncommon', zone: 'volcano', rate: 170 },
  { id: 'tiki', name: 'Tikindle', type: 'Fire', tier: 'Rare', zone: 'volcano', rate: 75, flying: true },
  { id: 'dragon', name: 'Dinomber', type: 'Dragon', tier: 'Epic', zone: 'volcano', rate: 45, flying: true },
  // Frost Peak
  { id: 'yeti', name: 'Frostub', type: 'Ice', tier: 'Common', zone: 'peak', rate: 200 },
  { id: 'brute', name: 'Clubbit', type: 'Ice', tier: 'Uncommon', zone: 'peak', rate: 150 },
  { id: 'alpaca', name: 'Helmlet', type: 'Steel', tier: 'Rare', zone: 'peak', rate: 60 },
  // Sunstone Ruins
  { id: 'cactus', name: 'Pricklet', type: 'Grass', tier: 'Common', zone: 'ruins', rate: 235 },
  { id: 'orc', name: 'Grumblet', type: 'Fighting', tier: 'Uncommon', zone: 'ruins', rate: 190 },
  { id: 'wisp', name: 'Hywisp', type: 'Electric', tier: 'Uncommon', zone: 'ruins', rate: 150, flying: true },
  { id: 'wizard', name: 'Hexie', type: 'Psychic', tier: 'Rare', zone: 'ruins', rate: 75 },
  { id: 'alien', name: 'Zorblet', type: 'Psychic', tier: 'Epic', zone: 'ruins', rate: 25 },
  // Segunda oleada (Quaternius CC0: Animated Enemies, Dinosaurs, Fish). Al final para no mover los Dex #.
  { id: 'rat', name: 'Squeakit', type: 'Normal', tier: 'Common', zone: 'meadow', rate: 235 },
  { id: 'wasp', name: 'Stingo', type: 'Bug', tier: 'Uncommon', zone: 'meadow', rate: 170, flying: true },
  { id: 'para', name: 'Parablo', type: 'Grass', tier: 'Uncommon', zone: 'meadow', rate: 170 },
  { id: 'koi', name: 'Koilet', type: 'Water', tier: 'Common', zone: 'lake', rate: 245, flying: true },
  { id: 'puffer', name: 'Puffip', type: 'Water', tier: 'Uncommon', zone: 'lake', rate: 180, flying: true },
  { id: 'shark', name: 'Chompfin', type: 'Water', tier: 'Rare', zone: 'lake', rate: 75, flying: true },
  { id: 'angler', name: 'Spinelure', type: 'Dark', tier: 'Rare', zone: 'lake', rate: 70, flying: true },
  { id: 'apato', name: 'Neckling', type: 'Dragon', tier: 'Epic', zone: 'lake', rate: 30 },
  { id: 'spider', name: 'Webbit', type: 'Bug', tier: 'Uncommon', zone: 'woods', rate: 170 },
  { id: 'rex', name: 'Raptix', type: 'Dragon', tier: 'Rare', zone: 'volcano', rate: 70 },
  { id: 'trike', name: 'Trikit', type: 'Rock', tier: 'Uncommon', zone: 'peak', rate: 160 },
  { id: 'stego', name: 'Stegling', type: 'Steel', tier: 'Rare', zone: 'peak', rate: 70 },
  { id: 'snake', name: 'Hissle', type: 'Ground', tier: 'Common', zone: 'ruins', rate: 225 },
];

/** Colores de tipo, de species.js — para las fichas del Dex. */
export const TYPE_COLORS: Record<MonType, string> = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Grass: '#5fbd3e', Electric: '#f7d02c', Ice: '#76d4d0',
  Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf65', Flying: '#8fa8f5', Psychic: '#f95587', Bug: '#a6b91a',
  Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#8f9bb3', Fairy: '#e89fd8',
};

// ---------- captura ----------
export type BallKey = 'ball' | 'super' | 'hyper' | 'hood';

export interface Ball {
  name: string;
  /** Multiplicador sobre la probabilidad base; Infinity = captura garantizada (Hood Ball). */
  mult: number;
  /** Color del hemisferio superior (para el icono y la bola 3D). */
  color: number;
}

/** Las bolas, de research/pokegrass-source/lib/species.js. */
export const BALLS: Record<BallKey, Ball> = {
  ball: { name: 'Grass Ball', mult: 1, color: 0x39c25a },
  super: { name: 'Super Ball', mult: 1.6, color: 0x2f7cf6 },
  hyper: { name: 'Hyper Ball', mult: 2.3, color: 0x8e44ec },
  hood: { name: 'Hood Ball', mult: Infinity, color: 0xf4b400 },
};
export const BALL_ORDER: BallKey[] = ['ball', 'super', 'hyper', 'hood'];

/**
 * Probabilidad base de captura (una tirada con bola normal y calidad neutra), de la catchRate() de
 * lib/species.js: 0.08 + 0.72·(rate/255)^0.9, acotada a [0.04, 0.85]. Sin blockchain no aplicamos los
 * factores de etapa/market-cap (el original los multiplica); el `rate` de la especie es lo que manda.
 */
export function baseCatch(rate: number): number {
  return Math.max(0.04, Math.min(0.85, 0.08 + 0.72 * Math.pow(rate / 255, 0.9)));
}

/**
 * Probabilidad de que un lanzamiento atrape, 1:1 con species.js: base elevada por el multiplicador de la
 * bola y la calidad del tiro (1 a 1.35), con tope 0.97. La Hood Ball (mult Infinity) siempre atrapa.
 */
export function catchChance(base: number, ball: BallKey, quality = 1): number {
  const m = BALLS[ball]?.mult ?? 1;
  if (m === Infinity) return 1;
  const q = Math.max(1, Math.min(1.35, quality));
  return Math.min(0.97, 1 - Math.pow(1 - base, m * q));
}

export interface Spawn {
  /** Identidad estable del ejemplar salvaje (clave de render y del conjunto de atrapados). */
  id: string;
  species: Species;
  /** Ruta del GLB en /public/monsters. */
  model: string;
  x: number;
  z: number;
  /** Altura objetivo del monstruo en metros (el avatar mide ~1.75). */
  size: number;
  /** Etapa evolutiva (1..3). Los de demo son siempre 1. */
  stage?: number;
  /** Probabilidad base por tiro ya calculada (catchRate con market cap). Si falta, sale del `rate`. */
  base?: number;
  /** El token de Arc que es este monstruo; ausente en los monstruos de demo. */
  token?: SpawnToken;
  /** 'lure' / 'safari': traído por un objeto de la tienda, solo para este jugador y con caducidad. */
  kind?: 'wild' | 'lure' | 'safari' | 'summit' | 'golden';
  expiresAt?: number;
}

export interface SpawnToken {
  address: string;
  symbol: string;
  name: string;
  marketCap: number;
  liquidityUsd: number;
  createdAt: number;
  /** Logo del token: pinta al monstruo y su moneda (tokenLook.ts). */
  logo?: string;
}

/** Escoge una posición de spawn dentro de una zona: primera mancha de esa zona, o su punto de entrada. */
function spotIn(zone: ZoneKey, jitter = 0): { x: number; z: number } {
  const patches = patchesOf(zone);
  if (patches.length) {
    const p = patches[0];
    return { x: p.x + jitter, z: p.z + jitter };
  }
  const place: Place = PLACES[zone];
  return { x: place.entry[0] + jitter, z: place.entry[1] + jitter };
}

const byId = (id: string) => SPECIES_CATALOG.find((s) => s.id === id)!;

/**
 * Monstruos de demo: uno o dos por bioma salvaje. Son el respaldo cuando el feed de Arc no responde (ver
 * wildStore.ts); con feed, los salvajes del mundo son tokens reales.
 */
// Alturas objetivo en metros. Se subieron respecto al primer prototipo (1.2–1.9): a esa escala los
// monstruos se leían diminutos junto al trainer (~1.75 m) y en pantalla. Ahora van de ~2.2 a ~3.4 m, que
// es la presencia que tienen los salvajes en PokeGrass — se ven de lejos y llenan el encuentro.
export const SPAWNS: Spawn[] = [
  { id: 'w-bee', species: byId('bee'), model: '/monsters/Armabee.glb', ...spotIn('meadow', 0), size: 2.3 },
  { id: 'w-cat', species: byId('cat'), model: '/monsters/Cat.glb', ...spotIn('meadow', -6), size: 2.2 },
  { id: 'w-frog', species: byId('frog'), model: '/monsters/Frog.glb', ...spotIn('lake'), size: 2.4 },
  { id: 'w-monkey', species: byId('monkey'), model: '/monsters/Monkroose.glb', ...spotIn('woods'), size: 2.7 },
  { id: 'w-ghost', species: byId('ghost'), model: '/monsters/Ghost.glb', ...spotIn('woods', -7), size: 2.4 },
  { id: 'w-dragon', species: byId('dragon'), model: '/monsters/Dragon.glb', ...spotIn('volcano'), size: 3.4 },
  { id: 'w-yeti', species: byId('yeti'), model: '/monsters/Yeti.glb', ...spotIn('peak'), size: 3.0 },
  { id: 'w-cactus', species: byId('cactus'), model: '/monsters/Cactoro.glb', ...spotIn('ruins'), size: 2.5 },
];

export { surfaceY };
