// La región abierta: dónde está cada lugar, la altura del suelo, el color del terreno, los caminos entre
// lugares y qué es caminable. Puro (matemáticas), sin THREE salvo para Vector3/Color/CatmullRom — se puede
// llamar igual desde el mundo 3D, la cámara, el minimapa y (más adelante) el servidor.
// Portado 1:1 desde pokegrass-source/js/terrain.js (ver research/) — misma fórmula, mismo layout de biomas.
import * as THREE from 'three';
import { rng, fbm, n1, n2, n3, smooth, lerp } from './noise';

export { fbm, n1, n2, n3 };

// ---------- los lugares ----------
export const WATER_Y = -0.45;

export interface Place {
  x: number;
  z: number;
  r: number;
  level: number;
  entry: [number, number];
}

export const PLACES: Record<string, Place> = {
  meadow: { x: 0, z: 0, r: 36, level: 0, entry: [0, 9] },
  lake: { x: -98, z: 12, r: 48, level: 0.25, entry: [-66, 13] },
  woods: { x: 94, z: 16, r: 46, level: 0.3, entry: [72, 15] },
  volcano: { x: -80, z: -94, r: 46, level: 1.2, entry: [-62, -86] },
  peak: { x: 82, z: -94, r: 46, level: 1.4, entry: [64, -88] },
  ruins: { x: 0, z: 104, r: 44, level: 0.6, entry: [-1, 84] },
  summit: { x: 0, z: -128, r: 26, level: 7, entry: [0, -110] },
  // --- la expansión: tres islas elementales en el anillo exterior de la región, cada una con su coliseo.
  // Mismo lenguaje que los biomas de siempre (un centro, un radio y una cota), así que heredan gratis las
  // alturas, el color del suelo, los props, el minimapa y el cartel de "entrando en…".
  storm: { x: -128, z: 104, r: 40, level: 2.6, entry: [-104, 96] },
  sands: { x: 124, z: 104, r: 42, level: 0.35, entry: [100, 96] },
  crystal: { x: 168, z: -40, r: 38, level: 1.9, entry: [146, -30] },
};
export const PLACE_KEYS = Object.keys(PLACES);

export const POND = { x: 17, z: 15, r: 4.2 };
export const LAKE = { x: -103, z: 12, rx: 30, rz: 24 };
export const ISLAND = { x: -110, z: 5, r: 4.8 };
export const PIER = { x0: -73.4, x1: -91, z: 21, w: 2.8, y: WATER_Y + 0.55 };
export const LAVA = [
  { x: -73, z: -84, rx: 8, rz: 5.5 },
  { x: -94, z: -99, rx: 6, rz: 4.5 },
  { x: -66, z: -106, rx: 4.8, rz: 3.6 },
];
export const ICE = { x: 82, z: -84, rx: 11, rz: 7 };
export const VOLCANO = { x: -122, z: -156, r: 62, h: 64 };
export const CONE = { x: -78, z: -98, r: 6.6, h: 6.2, rim: 2.3, depth: 2.1, streams: [[1.228, 1.1], [-3.079, 0.72], [-0.588, 0.66]] as [number, number][] };
export const MOUNT = { x: 116, z: -158, r: 70, h: 82 };
export const PLAZA = { x: 0, z: 104, r: 13 };
export const CAMP = { x: -19, z: 13 };
/**
 * Punto de aparición del jugador. Vive aquí, y no solo en Scene.tsx, porque la colocación de props
 * necesita despejarlo: la cámara sigue al jugador desde 14 m detrás y 12 m de alto, así que un árbol de
 * 12 m plantado junto al spawn deja la cámara dentro de la copa y la primera imagen del juego es una
 * pantalla de hojas.
 */
export const SPAWN = { x: 0, z: 9 };
/**
 * Radio despejado de vegetación alta alrededor del spawn. Lo justo para que la cámara no arranque dentro
 * de una copa, pero no tanto que la primera vista sea un prado pelado sin nada que mirar.
 */
export const SPAWN_CLEARING = 11;
/**
 * Tamaño de los coliseos. El edificio original medía 18 m de pista: con 2 se volvía un estadio que
 * tapaba el bioma. 1.5 lo deja reconocible desde lejos y todavía se entra por el portón, sin comerse
 * la pradera.
 *
 * Es un solo número a propósito: lo multiplican los radios de aquí (que es lo que usan el terreno, las
 * colisiones y la colocación de props) y la geometría 3D entera se escala por él en Colosseum.tsx, así
 * que no hay dos sitios donde se pueda quedar desincronizado.
 */
export const COLISEUM_SCALE = 1.5;
const CS = COLISEUM_SCALE;
/** Radios del coliseo: arena de piedra, muro de la barrera, gradas de madera y muralla exterior. */
export const COLISEUM = { floor: 9 * CS, barrier: 9.6 * CS, stands0: 10.1 * CS, wall: 14.4 * CS, wallT: 0.9 * CS, clear: 23 * CS };

/**
 * Un coliseo del circuito. Todos comparten la misma planta (COLISEUM) para que se lean como el mismo
 * edificio de la región; lo que cambia por sede es dónde está, cómo está girada y de qué colores viste.
 *
 * `rot` gira el recinto entero: 0 deja el portón mirando al oeste (−x), que es como está el de la pradera.
 * `level` es la cota plana del recinto; si no se fija, se toma de la altura natural del terreno en su
 * centro (ver siteLevel), así una sede en la ladera del pico se asienta sola a su altura.
 */
export interface ColiseumSite {
  key: string;
  /** Bioma al que pertenece, para el minimapa y el color de la explanada. */
  zone: string;
  x: number;
  z: number;
  rot: number;
  level?: number;
  /** La sede principal: la que tiene camino de llegada, público y combates. */
  home?: boolean;
  /** Colores del edificio: los dos bandos, el tejado de las torres y la piedra. */
  theme: { a: number; b: number; stone: number; wood: number };
}

export const COLISEUMS: ColiseumSite[] = [
  // La sede de siempre, al este del camino que baja de la pradera a las ruinas, con su ramal (PATHS.arena)
  // entrando por la puerta oeste. La cortinilla del combate sigue llevando la cámara aquí.
  { key: 'grand', zone: 'meadow', x: 30, z: 45, rot: 0, level: 0.95, home: true, theme: { a: 0x2f64c9, b: 0xc23a2e, stone: 0xc2b59c, wood: 0xa0703f } },
  { key: 'ember', zone: 'volcano', x: -98, z: -70, rot: 0.5, theme: { a: 0xff7a2f, b: 0x3a2320, stone: 0x6f5e58, wood: 0x5a3a28 } },
  { key: 'frost', zone: 'peak', x: 100, z: -74, rot: -0.6, theme: { a: 0x7fd4ff, b: 0xe8f4ff, stone: 0xd7e3ee, wood: 0x8fa3b4 } },
  { key: 'canopy', zone: 'woods', x: 108, z: 34, rot: 1.1, theme: { a: 0x3fa65a, b: 0xf2c14e, stone: 0xa9b59a, wood: 0x6b4526 } },
  { key: 'relic', zone: 'ruins', x: -26, z: 114, rot: -1.2, theme: { a: 0xe0b85a, b: 0x2fa89a, stone: 0xd9c79a, wood: 0x8a6a3a } },
  { key: 'tide', zone: 'lake', x: -70, z: 36, rot: 2.3, theme: { a: 0x3fb8d8, b: 0xf3ead2, stone: 0xbfc9c4, wood: 0x8a6b4a } },
  { key: 'bolt', zone: 'storm', x: -126, z: 100, rot: 3.0, theme: { a: 0xf2d53c, b: 0x6a4fd0, stone: 0x8b86a6, wood: 0x4c4663 } },
  { key: 'dune', zone: 'sands', x: 122, z: 100, rot: -0.2, theme: { a: 0xf0a83c, b: 0xc2522f, stone: 0xe4d3a4, wood: 0xa5793f } },
  { key: 'prism', zone: 'crystal', x: 166, z: -36, rot: 0.25, theme: { a: 0xa98cff, b: 0x7fe6ff, stone: 0xc6cfe8, wood: 0x6f7aa0 } },
];
export const COLISEUM_BY_KEY: Record<string, ColiseumSite> = Object.fromEntries(COLISEUMS.map((c) => [c.key, c]));
/** La sede principal. Se exporta como ARENA porque todo el sistema de combate la nombra así. */
export const ARENA: ColiseumSite = COLISEUMS[0];

/**
 * Los lugares construidos de la región (el embarcadero pirata, el puerto de las dunas, las ruinas de
 * mazmorra, el fuerte de la meseta…). Aquí viven solo sus coordenadas, su giro y el radio que ocupan,
 * porque eso es lo que necesita el mapa: `clearOf` los respeta para no sembrarles un bosque encima. Las
 * piezas de cada conjunto se montan en Landmarks.tsx.
 */
export interface BuiltSite { key: string; zone: string; x: number; z: number; rot: number; r: number }
export const BUILT: BuiltSite[] = [
  { key: 'cove', zone: 'lake', x: -72, z: 2, rot: 0, r: 20 },
  { key: 'port', zone: 'sands', x: 158, z: 132, rot: -0.6, r: 22 },
  { key: 'crypt', zone: 'crystal', x: 134, z: -78, rot: 0.4, r: 24 },
  { key: 'fort', zone: 'storm', x: -164, z: 134, rot: 1.1, r: 22 },
  { key: 'temple', zone: 'ruins', x: 20, z: 118, rot: -0.3, r: 20 },
  { key: 'grove', zone: 'woods', x: 80, z: 6, rot: 0.9, r: 18 },
];
/** Distancia al borde del sitio construido más cercano (negativa dentro de él). */
export function builtDist(x: number, z: number): number {
  let d = Infinity;
  for (const b of BUILT) d = Math.min(d, dist(x, z, b) - b.r);
  return d;
}

export interface Patch { x: number; z: number; rx: number; rz: number; zone: string }
export const PATCHES: Patch[] = [
  { x: -9.5, z: 3, rx: 6.2, rz: 4.4, zone: 'meadow' }, { x: 9, z: 4.5, rx: 6.4, rz: 4.2, zone: 'meadow' },
  { x: -2, z: -7.5, rx: 7.2, rz: 3.8, zone: 'meadow' }, { x: 14.5, z: -6.5, rx: 4.8, rz: 3.6, zone: 'meadow' },
  { x: -16, z: -8, rx: 4.6, rz: 3.4, zone: 'meadow' },
  { x: -78, z: 33, rx: 6, rz: 3.6, zone: 'lake' }, { x: -79, z: -8, rx: 6, rz: 3.8, zone: 'lake' },
  { x: 82, z: 6, rx: 7, rz: 5, zone: 'woods' }, { x: 101, z: 29, rx: 7, rz: 5, zone: 'woods' },
  { x: 106, z: 3, rx: 6, rz: 4.5, zone: 'woods' }, { x: 85, z: 32, rx: 5.5, rz: 4, zone: 'woods' },
  { x: -84, z: -78, rx: 6, rz: 4.2, zone: 'volcano' }, { x: -80, z: -110, rx: 6, rz: 4, zone: 'volcano' },
  { x: -98, z: -84, rx: 5, rz: 3.8, zone: 'volcano' },
  { x: 70, z: -104, rx: 6, rz: 4.5, zone: 'peak' }, { x: 96, z: -98, rx: 6, rz: 4.2, zone: 'peak' },
  { x: 66, z: -78, rx: 5, rz: 3.6, zone: 'peak' },
  { x: -15, z: 97, rx: 6, rz: 4.4, zone: 'ruins' }, { x: 15, z: 112, rx: 6, rz: 4.4, zone: 'ruins' },
  { x: 16, z: 94, rx: 5, rz: 3.8, zone: 'ruins' }, { x: -14, z: 115, rx: 5.5, rz: 4, zone: 'ruins' },
  { x: -142, z: 92, rx: 6, rz: 4.2, zone: 'storm' }, { x: -116, z: 118, rx: 5.5, rz: 4, zone: 'storm' },
  { x: 138, z: 94, rx: 6, rz: 4.2, zone: 'sands' }, { x: 112, z: 120, rx: 5.5, rz: 4, zone: 'sands' },
  { x: 178, z: -26, rx: 5.5, rz: 4, zone: 'crystal' }, { x: 156, z: -54, rx: 5, rz: 3.8, zone: 'crystal' },
];
export function inPatch(x: number, z: number, pad = 0): Patch | null {
  for (const p of PATCHES) {
    const dx = (x - p.x) / (p.rx - pad), dz = (z - p.z) / (p.rz - pad);
    if (dx * dx + dz * dz < 1) return p;
  }
  return null;
}
export const patchesOf = (zone: string) => PATCHES.filter((p) => p.zone === zone);

// ---------- caminos ----------
const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);
export const PATHS: Record<string, THREE.CatmullRomCurve3> = {
  main: new THREE.CatmullRomCurve3([V(-3, 60), V(-1.5, 22), V(0.8, 11), V(-0.4, 1.5), V(2.5, -2.5), V(5, -14), V(1, -26), V(-4, -70)]),
  south: new THREE.CatmullRomCurve3([V(-3, 60), V(-2.2, 74), V(-0.5, 88), V(0, 100)]),
  north: new THREE.CatmullRomCurve3([V(-4, -70), V(-2.5, -88), V(-0.5, -104), V(0, -118)]),
  west: new THREE.CatmullRomCurve3([V(0.4, -0.6), V(-12, -2.4), V(-25, -1.4), V(-41, 3.5), V(-57, 10), V(-70, 14.5)]),
  east: new THREE.CatmullRomCurve3([V(2.8, -2.3), V(13, -1.2), V(26, 0.2), V(43, 5.5), V(60, 12), V(74, 16)]),
  crater: new THREE.CatmullRomCurve3([V(-1.2, -44), V(-18, -57), V(-37, -70), V(-54, -81), V(-64, -88)]),
  frost: new THREE.CatmullRomCurve3([V(-1.2, -46), V(17, -60), V(37, -73), V(55, -84), V(66, -90)]),
  arena: new THREE.CatmullRomCurve3([V(-2.1, 36), V(4, 38.6), V(10, 42.4), V(ARENA.x - COLISEUM.wall - 1.5, ARENA.z)]),
  // Los tres ramales de la expansión: salen de los caminos que ya existían (el del sur hacia las ruinas,
  // el del este hacia el bosque y el del oeste hacia el lago) y llevan a las islas elementales.
  // Cada uno termina en la boca del portón de su coliseo (gateMouth), no en su centro: si acabaran
  // dentro del recinto, el camino entraría por debajo de la muralla y el último tramo sería intransitable.
  storm: new THREE.CatmullRomCurve3([V(-6, 70), V(-30, 80), V(-58, 90), V(-86, 98), V(-108.9, 102.4)]),
  dunes: new THREE.CatmullRomCurve3([V(4, 72), V(30, 82), V(58, 92), V(86, 98), V(105.2, 96.6)]),
  crystal: new THREE.CatmullRomCurve3([V(74, 16), V(100, 8), V(126, -8), V(142, -22), V(149.2, -31.7)]),
};
// Distancia al camino más cercano, precalculada en una grilla de 1 m para lookups rápidos.
const G = { min: -240, size: 480, n: 481, max: 9 };
const pathGrid = new Float32Array(G.n * G.n).fill(G.max);
for (const curve of Object.values(PATHS)) {
  const len = curve.getLength();
  const pts = curve.getSpacedPoints(Math.ceil(len * 2));
  for (const p of pts) {
    const cx = Math.round(p.x - G.min), cz = Math.round(p.z - G.min);
    for (let dz = -G.max; dz <= G.max; dz++) {
      for (let dx = -G.max; dx <= G.max; dx++) {
        const gx = cx + dx, gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= G.n || gz >= G.n) continue;
        const d = Math.hypot(gx + G.min - p.x, gz + G.min - p.z), i = gz * G.n + gx;
        if (d < pathGrid[i]) pathGrid[i] = d;
      }
    }
  }
}
const ARENA_ROAD = PATHS.arena.getSpacedPoints(40);
/** Distancia al ramal del coliseo: a sus lados van los puestos y antorchas, sin árboles ni rocas. */
export function arenaRoadDist(x: number, z: number): number {
  let d = Infinity;
  for (const p of ARENA_ROAD) d = Math.min(d, Math.hypot(x - p.x, z - p.z));
  return d;
}
export function pathDist(x: number, z: number): number {
  const fx = x - G.min, fz = z - G.min, ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= G.n - 1 || iz >= G.n - 1) return G.max;
  const tx = fx - ix, tz = fz - iz, i = iz * G.n + ix;
  return lerp(lerp(pathGrid[i], pathGrid[i + 1], tx), lerp(pathGrid[i + G.n], pathGrid[i + G.n + 1], tx), tz);
}

// ---------- altura ----------
export const ell = (x: number, z: number, e: { x: number; z: number; rx: number; rz: number }) => Math.hypot((x - e.x) / e.rx, (z - e.z) / e.rz);
export const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);

/** Cuánto pertenece un punto a un lugar (1 en el centro, 0 fuera) — para alturas, colores, niebla. */
export function placeWeight(x: number, z: number, key: string): number {
  const p = PLACES[key];
  return 1 - smooth(p.r * 0.72, p.r * 1.12, dist(x, z, p));
}
export function placeAt(x: number, z: number): string | null {
  let best: string | null = null, bw = 0.35;
  for (const k of PLACE_KEYS) {
    const w = placeWeight(x, z, k);
    if (w > bw) { bw = w; best = k; }
  }
  return best;
}

/**
 * El terreno natural, sin los recintos de los coliseos. heightAt los aplana encima de esto, y así la cota
 * de una sede que no la fija a mano sale de aquí (siteLevel) sin morderse la cola.
 */
function rawHeight(x: number, z: number): number {
  const pd = pathDist(x, z), onPath = 1 - smooth(1.2, 4.5, pd);
  let rough = (fbm(x * 0.03 + 3, z * 0.03 - 2) - 0.5) * 3.2 + (n2(x * 0.12, z * 0.12) - 0.5) * 0.3;
  let h = 0.9 + Math.max(-0.6, rough) * (1 - onPath * 0.7);

  for (const k of PLACE_KEYS) {
    if (k === 'summit') continue;
    const w = placeWeight(x, z, k);
    if (w <= 0) continue;
    const p = PLACES[k];
    let local = p.level;
    if (k === 'meadow') local += (fbm(x * 0.045 + 3, z * 0.045 - 2) - 0.5) * 0.8 + (n2(x * 0.12, z * 0.12) - 0.5) * 0.25;
    else if (k === 'woods') local += (fbm(x * 0.08, z * 0.08) - 0.5) * 1.3;
    else if (k === 'volcano') local += (fbm(x * 0.07 + 9, z * 0.07) - 0.5) * 1.6 + (n3(x * 0.3, z * 0.3) - 0.5) * 0.3;
    else if (k === 'peak') local += (fbm(x * 0.05, z * 0.05 + 4) - 0.5) * 1.6 + smooth(-80, -125, z) * 5;
    else if (k === 'ruins') local += (fbm(x * 0.06 + 5, z * 0.06) - 0.5) * 1.4 * smooth(PLAZA.r, PLAZA.r + 8, dist(x, z, PLAZA));
    else if (k === 'lake') local += (fbm(x * 0.06, z * 0.06) - 0.5) * 0.5;
    // Mesetas escalonadas en la isla de la tormenta, dunas de seno largo en la de arena y crestas
    // agudas en la de cristal: cada una tiene que leerse distinta ya desde la silueta del terreno.
    else if (k === 'storm') local += (fbm(x * 0.055 + 13, z * 0.055 - 4) - 0.5) * 2.4 + Math.round(n2(x * 0.03, z * 0.03) * 3) * 0.55;
    else if (k === 'sands') local += (fbm(x * 0.05 - 6, z * 0.05 + 8) - 0.5) * 1.1 + Math.sin(x * 0.11 + z * 0.05) * 0.55;
    else if (k === 'crystal') local += (fbm(x * 0.075 + 21, z * 0.075 - 5) - 0.5) * 2.6;
    h = lerp(h, local, w);
  }

  const dsu = dist(x, z, PLACES.summit);
  if (dsu < 40) { const top = 1 - smooth(13, 36, dsu); h = lerp(h, 0.8, Math.min(1, top * 3)) + 6.4 * top; }
  if (onPath > 0) h -= onPath * 0.06;

  const pdn = dist(x, z, POND);
  if (pdn < POND.r + 1.6) { const k = 1 - Math.min(1, pdn / (POND.r + 1.6)); h -= Math.min(1, k * 2.2) * 1.1; }

  const e = ell(x, z, LAKE);
  if (e < 1.3) {
    if (e >= 1) h = lerp(WATER_Y + 0.04, h, smooth(1, 1.3, e));
    else h = WATER_Y + 0.04 - 3.4 * smooth(1, 0.7, e);
    const di = dist(x, z, ISLAND);
    if (di < ISLAND.r + 3) h = Math.max(h, lerp(0.55, h, smooth(ISLAND.r * 0.6, ISLAND.r + 3, di)));
  }

  for (const L of LAVA) { const le = ell(x, z, L); if (le < 1.4) h -= 1.1 * (1 - smooth(0.75, 1.35, le)); }

  const ie = ell(x, z, ICE);
  if (ie < 1.25) h = lerp(PLACES.peak.level + 0.1, h, smooth(1, 1.25, ie));

  h = coast(x, z, h);

  const dv = dist(x, z, VOLCANO);
  if (dv < VOLCANO.r) { h += VOLCANO.h * Math.pow(1 - dv / VOLCANO.r, 1.35); if (dv < 11) h -= Math.pow(1 - dv / 11, 2) * 20; }

  const dm = dist(x, z, MOUNT);
  if (dm < MOUNT.r) h += MOUNT.h * Math.pow(1 - dm / MOUNT.r, 1.5) * (0.85 + fbm(x * 0.05, z * 0.05) * 0.3);

  return h;
}

/**
 * La costa. Antes aquí había una cordillera: más allá de cierto radio el terreno subía en vertical y el
 * mundo quedaba encerrado en un cuenco de montañas, que es el truco de mapa de toda la vida. Ahora pasa
 * lo contrario — el terreno baja, se vuelve arena y entra en el mar abierto, así que la región se lee
 * como una isla grande con playas y no como un valle tapiado. El volcán y la montaña del norte se
 * aplican DESPUÉS (ver rawHeight), de modo que siguen levantándose aunque les toque la franja de costa:
 * dos moles saliendo del agua.
 */
export const COAST_FROM = 185;
/** Cota a la que se aplana la franja de playa, justo por encima de la lámina de agua. */
const BEACH_Y = 0.2;
/** Donde la playa entra en el agua y, con ella, el borde real del mundo caminable. */
export const SHORE = 232;
/** Radio del disco de mar: más allá solo hay agua, que la niebla funde con el cielo. */
export const WORLD_R = 272;
/** Hasta dónde tiene sentido sembrar props: la tierra firme, sin la playa ni el mar. */
export const LAND_R = COAST_FROM + 16;

function coast(x: number, z: number, h: number): number {
  const R = Math.hypot(x, z * 0.95);
  if (R < COAST_FROM) return h;
  // Primero el terreno pierde relieve y se tumba a la cota de playa; después se hunde hacia el fondo.
  let out = lerp(h, BEACH_Y, smooth(COAST_FROM, SHORE - 14, R));
  out = lerp(out, WATER_Y - 8, smooth(SHORE - 4, SHORE + 34, R));
  // Un poco de ruido en la orilla para que la línea de costa no sea un círculo perfecto.
  return out + (fbm(x * 0.035 + 17, z * 0.035 - 9) - 0.5) * 2.2 * (1 - smooth(COAST_FROM, SHORE, R));
}

const siteLevels = new Map<string, number>();
/** Cota plana del recinto de una sede: la que fija su ficha, o la del terreno natural en su centro. */
export function siteLevel(s: ColiseumSite): number {
  if (s.level !== undefined) return s.level;
  let v = siteLevels.get(s.key);
  if (v === undefined) { v = rawHeight(s.x, s.z); siteLevels.set(s.key, v); }
  return v;
}

/**
 * La altura del suelo. Sobre el terreno natural, cada coliseo aplana su explanada hacia su propia cota,
 * para que el recinto se asiente sin escalones aunque caiga en una ladera.
 */
export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);
  for (const s of COLISEUMS) {
    const d = dist(x, z, s);
    if (d < COLISEUM.wall + 9 * CS) h = lerp(h, siteLevel(s), 1 - smooth(COLISEUM.wall + 1.5 * CS, COLISEUM.wall + 9 * CS, d));
  }
  return h;
}

// ---------- el volcán pequeño de Ember Crater ----------
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const streamAxis = (sa: number, r: number) =>
  sa + 0.16 * Math.sin(r * 1.2 + sa * 3) * Math.max(0, 1 - Math.max(0, r - CONE.rim) / (CONE.r - CONE.rim));

export interface ConeShape { y: number; lava: number; r: number }
export function coneShape(x: number, z: number, out: ConeShape = { y: 0, lava: 0, r: 0 }): ConeShape {
  const dx = x - CONE.x, dz = z - CONE.z, r = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
  const wob = 0.07 * Math.sin(5 * a + 1.3) + 0.045 * Math.sin(9 * a + 0.4) + 0.025 * Math.sin(14 * a + 2.1);
  const R = CONE.r * (1 + wob), rim = CONE.rim * (1 + wob * 0.4);
  out.y = 0; out.lava = 0; out.r = r;
  if (r >= R) return out;
  if (r >= rim) {
    const s = (R - r) / (R - rim);
    let y = CONE.h * Math.pow(s, 1.45) * (1 + 0.06 * Math.sin(7 * a + 0.6) * s) + 0.28 * Math.exp(-(((r - rim) / 0.45) ** 2));
    for (const [sa, len] of CONE.streams) {
      const along = 1 - s, across = angDist(a, streamAxis(sa, r)) * r;
      if (along > len + 0.1) continue;
      y -= 0.34 * Math.exp(-((across / 0.75) ** 2)) * Math.min(1, along * 6) * Math.min(1, s * 3);
      const l = (1 - smooth(0.26, 0.6, across)) * (1 - smooth(len - 0.14, len + 0.04, along));
      if (l > out.lava) out.lava = l;
    }
    out.y = y;
  } else out.y = CONE.h + 0.28 - CONE.depth * Math.pow(1 - (r / rim) ** 2, 0.8);
  return out;
}
const coneTmp: ConeShape = { y: 0, lava: 0, r: 0 };
export const coneY = (x: number, z: number) =>
  (x - CONE.x) ** 2 + (z - CONE.z) ** 2 > (CONE.r * 1.16) ** 2 ? 0 : coneShape(x, z, coneTmp).y;
export const solidY = (x: number, z: number) => heightAt(x, z) + coneY(x, z);

export const LAVA_RUN = (() => {
  const [a] = CONE.streams[0];
  const dx = Math.cos(a), dz = Math.sin(a), P = { x: -73, z: -84, rx: 8, rz: 5.5 };
  let t = CONE.r;
  while (t < 30 && Math.hypot((CONE.x + dx * t - P.x) / P.rx, (CONE.z + dz * t - P.z) / P.rz) > 1) t += 0.1;
  return { x0: CONE.x + dx * CONE.r * 0.93, z0: CONE.z + dz * CONE.r * 0.93, x1: CONE.x + dx * (t + 1.6), z1: CONE.z + dz * (t + 1.6), dx, dz };
})();
export function runDist(x: number, z: number): number {
  const R = LAVA_RUN, vx = R.x1 - R.x0, vz = R.z1 - R.z0, L2 = vx * vx + vz * vz;
  const t = Math.max(0, Math.min(1, ((x - R.x0) * vx + (z - R.z0) * vz) / L2));
  return Math.hypot(x - (R.x0 + vx * t), z - (R.z0 + vz * t));
}

// ---------- caminable ----------
export const onPier = (x: number, z: number) => x <= PIER.x0 + 0.6 && x >= PIER.x1 && Math.abs(z - PIER.z) < PIER.w / 2;
export function inLava(x: number, z: number, pad = 0) {
  for (const L of LAVA) if (Math.hypot((x - L.x) / (L.rx + pad), (z - L.z) / (L.rz + pad)) < 1) return L;
  if (runDist(x, z) < 0.7 + pad) return LAVA[0];
  return null;
}
export function walkable(x: number, z: number): boolean {
  if (Math.hypot(x, z * 0.95) > WORLD_R) return false;
  if (onPier(x, z)) return true;
  const h = heightAt(x, z);
  if (h < WATER_Y - 0.4) return false;
  if (inLava(x, z, 0.9)) return false;
  if (Math.hypot(x - CONE.x, z - CONE.z) < CONE.r * 1.02 + 0.3) return false;
  if (coliseumBlocks(x, z)) return false;
  const s = 0.7;
  const g = Math.max(Math.abs(heightAt(x + s, z) - heightAt(x - s, z)), Math.abs(heightAt(x, z + s) - heightAt(x, z - s))) / (2 * s);
  return g < 0.8;
}
/** Altura de la pista de piedra de una sede (el terreno debajo está aplanado a su cota). */
export const arenaY = (s: ColiseumSite = ARENA) => siteLevel(s) + 0.14;
/** Medio ancho del pasillo de la puerta, la única entrada al recinto. */
export const GATE_HALF = 1.7 * CS;
/**
 * Un punto del mundo en coordenadas locales de la sede (deshaciendo su giro): el portón siempre cae en
 * −x local, así que toda la geometría del recinto se escribe una sola vez y cada sede la gira.
 */
export function toLocal(s: ColiseumSite, x: number, z: number): [number, number] {
  const dx = x - s.x, dz = z - s.z;
  if (!s.rot) return [dx, dz];
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  return [dx * c - dz * sn, dx * sn + dz * c];
}
/** ¿Está el punto dentro del pasillo de la puerta de esa sede? */
export const inGateOf = (s: ColiseumSite, x: number, z: number) => {
  const [lx, lz] = toLocal(s, x, z);
  return lx < 0 && Math.abs(lz) < GATE_HALF;
};
export const inGate = (x: number, z: number) => inGateOf(ARENA, x, z);
/** La sede cuyo recinto (muralla incluida) contiene el punto, si hay alguna. */
export function coliseumAt(x: number, z: number, pad = 0): ColiseumSite | null {
  for (const s of COLISEUMS) if (dist(x, z, s) < COLISEUM.wall + COLISEUM.wallT + pad) return s;
  return null;
}
/** Distancia al coliseo más cercano, para los props: nada se planta dentro de una explanada. */
export function coliseumDist(x: number, z: number): number {
  let d = Infinity;
  for (const s of COLISEUMS) d = Math.min(d, dist(x, z, s));
  return d;
}
/** Barrera, gradas y muralla son macizas: solo se entra por el pasillo de la puerta. */
function coliseumBlocks(x: number, z: number): boolean {
  for (const s of COLISEUMS) {
    const d = dist(x, z, s);
    if (d < COLISEUM.floor + 0.3 || d > COLISEUM.wall + COLISEUM.wallT + 0.4) continue;
    const [lx, lz] = toLocal(s, x, z);
    if (lx >= 0 || Math.abs(lz) > GATE_HALF - 0.45) return true;
  }
  return false;
}
export function standY(x: number, z: number): number {
  if (onPier(x, z)) return PIER.y;
  for (const s of COLISEUMS) {
    const da = dist(x, z, s);
    if (da > COLISEUM.wall + COLISEUM.wallT + 0.6) continue;
    if (da < COLISEUM.floor + 0.2 || inGateOf(s, x, z)) return arenaY(s);
  }
  return heightAt(x, z);
}
const POND_Y = () => heightAt(POND.x, POND.z) + 0.72;
export function surfaceY(x: number, z: number): number {
  if (onPier(x, z)) return PIER.y;
  const h = heightAt(x, z);
  // El mar abierto: cualquier punto de la franja de costa que quede por debajo de la lámina.
  if (Math.hypot(x, z * 0.95) > COAST_FROM && h < WATER_Y) return WATER_Y;
  if (ell(x, z, LAKE) < 1.02) return Math.max(h, WATER_Y);
  if (dist(x, z, POND) < POND.r + 0.5) return Math.max(h, POND_Y());
  return h;
}

// ---------- color del suelo ----------
const C = (h: number) => new THREE.Color(h);
// Paleta del suelo. Es otra desde la expansión: los verdes del prado eran los amarillentos de la saga
// (#92cc6e) y los caminos, arena clara. Ahora el verde es más profundo y azulado —que es lo que pega con
// el cielo índigo y con el follaje del MegaKit— y los caminos son piedra gris, como las losas de las
// ruinas y los muelles. El resultado se parece poco al mapa anterior aunque la geometría sea la misma.
const COL: Record<string, THREE.Color[]> = {
  forest: [C(0x5aa05a), C(0x468a4e)], meadow: [C(0x7fc264), C(0x63a855)], woods: [C(0x2f6b45), C(0x24563a)],
  volcano: [C(0x5d4b45), C(0x7a5143)], peak: [C(0xf1f6fb), C(0xd9e4ef)], ruins: [C(0xdcc488), C(0xc4a96a)],
  lake: [C(0x6cbd7e), C(0x56a66c)], summit: [C(0x7fc264), C(0x63a855)],
  // Las islas elementales: basalto violeta de la tormenta, arena dorada de las dunas y esquisto pálido
  // del cristal. Son paletas vecinas de las que ya existían, no colores nuevos de otro juego.
  storm: [C(0x7a7596), C(0x5d5878)], sands: [C(0xf0dca2), C(0xdcc07c)], crystal: [C(0xbcc8e6), C(0x9aa7cf)],
};
const PATH_COL = C(0xbab7a8), PATH2_COL = C(0x9e9b8d), SAND = C(0xeee0ad), ROCK = C(0x8b8f86), SNOW = C(0xf4f7fb), ASH = C(0x3d3431), DARK = C(0x2e7a42), LAKEBED = C(0x58a79c);
const tmp = new THREE.Color(), tmp2 = new THREE.Color(), tmp3 = new THREE.Color();
const BASALT = [C(0x2c2422), C(0x4a3a34)], RUST = C(0x6e3a24), ASH2 = C(0x7a726c), CINDER = C(0x5a2b1f);

function volcanicFloor(x: number, z: number, out: THREE.Color): THREE.Color {
  out.copy(BASALT[0]).lerp(BASALT[1], fbm(x * 0.11 + 4, z * 0.11 - 3));
  const rust = n2(x * 0.32 + 1.7, z * 0.32); if (rust > 0.6) out.lerp(RUST, Math.min(1, (rust - 0.6) * 2.2) * 0.75);
  const cinder = n3(x * 0.9, z * 0.9); if (cinder > 0.72) out.lerp(CINDER, (cinder - 0.72) * 2.2);
  const ash = fbm(x * 0.045 - 7, z * 0.045 + 2); if (ash > 0.52) out.lerp(ASH2, Math.min(1, (ash - 0.52) * 3.2) * 0.62);
  const dc = dist(x, z, CONE); if (dc < CONE.r * 1.5) out.lerp(tmp3.copy(BASALT[0]), (1 - smooth(CONE.r, CONE.r * 1.5, dc)) * 0.3);
  return out;
}

export function groundColor(x: number, z: number, h = heightAt(x, z), out = new THREE.Color()): THREE.Color {
  const f = fbm(x * 0.07, z * 0.07);
  out.copy(COL.forest[0]).lerp(COL.forest[1], f);
  for (const k of PLACE_KEYS) {
    const w = placeWeight(x, z, k);
    if (w <= 0) continue;
    if (k === 'volcano') volcanicFloor(x, z, tmp);
    else tmp.copy(COL[k][0]).lerp(COL[k][1], f);
    out.lerp(tmp, w);
  }
  if (h > 12) out.lerp(tmp.copy(COL.forest[1]).lerp(ROCK, 0.35), Math.min(1, (h - 12) / 8));
  if (h > 24) out.lerp(ROCK, Math.min(0.85, (h - 24) / 10));
  if (h > 36 || (placeWeight(x, z, 'peak') > 0.2 && h > 3)) out.lerp(SNOW, Math.min(1, Math.max((h - 36) / 10, placeWeight(x, z, 'peak'))));
  if (dist(x, z, VOLCANO) < VOLCANO.r) out.lerp(ASH, Math.min(1, (1 - dist(x, z, VOLCANO) / VOLCANO.r) * 1.6));
  const patch = inPatch(x, z, -0.6);
  if (patch) {
    tmp2.copy(patch.zone === 'peak' ? SNOW : patch.zone === 'volcano' ? ASH : patch.zone === 'ruins' ? COL.ruins[1] : DARK);
    // Oscurecimiento suave. Iba a 0.55, y sumado a la hierba alta que ahora cubre estas manchas el
    // conjunto se iba a un verde apagado: la mancha tiene que leerse por la hierba, no por el suelo.
    out.lerp(tmp2, patch.zone === 'peak' ? 0.2 : 0.3);
  }
  const pd = pathDist(x, z), pw = 1.55 + (n2(x * 0.3, z * 0.3) - 0.5) * 0.5;
  if (pd < pw) {
    tmp.copy(PATH_COL).lerp(PATH2_COL, n2(x * 0.6, z * 0.6));
    const vw = placeWeight(x, z, 'volcano');
    if (vw > 0) tmp.lerp(tmp2.set(0x7d736c).lerp(tmp3.set(0x655c57), n2(x * 0.6, z * 0.6)), vw);
    out.lerp(tmp, Math.min(1, (pw - pd) / 0.45) * (placeWeight(x, z, 'peak') > 0.5 ? 0.6 : 1));
  }
  // La costa: hierba → arena → fondo de mar, por radio.
  const Rc = Math.hypot(x, z * 0.95);
  if (Rc > COAST_FROM + 14) {
    out.lerp(SAND, smooth(COAST_FROM + 14, SHORE - 16, Rc));
    if (h < WATER_Y + 0.2) out.lerp(LAKEBED, smooth(WATER_Y + 0.2, WATER_Y - 2.5, h));
  }
  const e = ell(x, z, LAKE);
  if (e < 1.22) out.lerp(e < 0.98 ? LAKEBED : SAND, e < 0.98 ? 1 : Math.min(1, (1.22 - e) / 0.12));
  const di = dist(x, z, ISLAND); if (di < ISLAND.r + 1) out.lerp(SAND, Math.min(1, (ISLAND.r + 1 - di) / 1.5) * 0.7);
  const pond = dist(x, z, POND); if (pond < POND.r + 1.1) out.lerp(SAND, Math.min(1, (POND.r + 1.1 - pond) / 0.8));
  for (const L of LAVA) { const le = ell(x, z, L); if (le < 1.6) out.lerp(tmp.set(0x1e1716), (1 - smooth(1, 1.6, le)) * 0.9); }
  const rd = runDist(x, z); if (rd < 2.2) out.lerp(tmp.set(0x1e1716), (1 - smooth(0.6, 2.2, rd)) * 0.9);
  const ie = ell(x, z, ICE); if (ie < 1.15) out.lerp(SNOW, 1 - smooth(1, 1.15, ie));
  const dp = dist(x, z, PLAZA); if (dp < PLAZA.r) out.lerp(tmp.set(0xcfc7b4), 0.75 * (1 - smooth(PLAZA.r - 3, PLAZA.r, dp)));
  const dar = coliseumDist(x, z); if (dar < COLISEUM.wall + 4) out.lerp(tmp.set(0xc3bda9), 0.8 * (1 - smooth(COLISEUM.wall + 0.5, COLISEUM.wall + 4, dar)));
  const ds = dist(x, z, PLACES.summit); if (ds < 13) out.lerp(tmp.set(0xe6d9b0), 0.85 * (1 - smooth(9.5, 13, ds)));
  return out;
}

const DRY = C(0x9aa06a), WORN = C(0xa89a7e), gTmp = new THREE.Color();
/**
 * El color del suelo tal como se pinta en 3D (y la raíz de las briznas, para que nazcan del mismo tono):
 * groundColor más manchas de hierba seca, tierra pisada al borde del camino y una desaturación leve hacia
 * la paleta terrosa del coliseo. Solo actúa donde el suelo es hierba, así nieve, arena y ceniza no cambian.
 */
export function naturalGroundColor(x: number, z: number, h = heightAt(x, z), out = new THREE.Color()): THREE.Color {
  groundColor(x, z, h, out);
  const grassy = Math.min(1, Math.max(0, (out.g - Math.max(out.r, out.b)) * 6));
  if (grassy <= 0) return out;
  out.lerp(DRY, smooth(0.55, 0.8, n3(x * 0.045 + 11, z * 0.045 - 7)) * grassy * 0.4);
  const worn = (1 - smooth(1.5, 3.6, pathDist(x, z))) * smooth(0.35, 0.7, n2(x * 0.45 + 3, z * 0.45)) * grassy;
  out.lerp(WORN, worn * 0.5);
  const l = out.r * 0.299 + out.g * 0.587 + out.b * 0.114;
  const s = 1 - 0.2 * grassy, v = 1 - 0.07 * grassy;
  gTmp.setRGB((l + (out.r - l) * s) * v, (l + (out.g - l) * s) * v, (l + (out.b - l) * s) * v);
  return out.copy(gTmp);
}

// ---------- ubicar props ----------
export function clearOf(x: number, z: number, pad = 2): boolean {
  if (inPatch(x, z, -pad) || pathDist(x, z) < 1.8 + pad * 0.5) return false;
  if (dist(x, z, POND) < POND.r + 1.2 + pad * 0.5 || ell(x, z, LAKE) < 1.08 + pad * 0.02 || inLava(x, z, 1 + pad * 0.4)) return false;
  if (dist(x, z, CAMP) < 5 + pad * 0.5 || ell(x, z, ICE) < 1.1) return false;
  // Los coliseos y sus explanadas: además, los planos de la cámara de combate pasan hasta ~21 m del centro.
  if (coliseumDist(x, z) < COLISEUM.clear + pad || arenaRoadDist(x, z) < 7.5 + pad * 0.3) return false;
  // Los conjuntos construidos: un embarcadero con un bosque dentro no se lee como embarcadero.
  if (builtDist(x, z) < pad * 0.5) return false;
  if (dist(x, z, PLAZA) < PLAZA.r + 1 || dist(x, z, PLACES.summit) < 15) return false;
  if (dist(x, z, CONE) < CONE.r * 1.15 + 1 + pad * 0.5 || runDist(x, z) < 1.4 + pad * 0.4) return false;
  if (x <= PIER.x0 + 3 && x >= PIER.x1 - 2 && Math.abs(z - PIER.z) < 4) return false;
  return true;
}
export function scatterIn(
  seed: number,
  n: number,
  test: (x: number, z: number, r: () => number) => boolean,
  fn?: (r: () => number) => number,
  { x0 = -LAND_R, x1 = LAND_R, z0 = -LAND_R, z1 = LAND_R } = {},
) {
  const R = rng(seed), out: { x: number; z: number; r: number; s: number }[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 60) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    if (!test(x, z, R)) continue;
    out.push({ x, z, r: R() * Math.PI * 2, s: fn ? fn(R) : 1 });
  }
  return out;
}
export const around = (key: string, r = PLACES[key].r) => ({ x0: PLACES[key].x - r, x1: PLACES[key].x + r, z0: PLACES[key].z - r, z1: PLACES[key].z + r });
