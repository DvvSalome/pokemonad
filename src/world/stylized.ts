// Dirección de arte de la región: qué especie crece en cada bioma, de qué altura real, en grupos de qué
// tamaño y con qué paleta. Es el único sitio que hay que tocar para cambiar cómo se ve el mundo.
//
// La flora sale del Stylized Nature MegaKit de Quaternius (CC0). Sustituye al Ultimate Stylized Nature
// Pack que usaba la versión anterior del mundo, y ese cambio es deliberado: los dos son del mismo autor,
// así que el acabado sigue siendo coherente, pero las siluetas son otras — árboles retorcidos de copa
// ancha, pinos de capas marcadas, helechos, setas, cantos rodados y losas de piedra. Un prado de este
// pack no se confunde con uno del anterior aunque se mire de lejos. Las palmeras vienen del Pirate Kit,
// que es lo que ata la costa y las dunas con los embarcaderos y los barcos (ver Landmarks.tsx).
//
// Las alturas están en metros y el avatar mide 1.75, así que se leen directamente. Cada GLB es un prop
// entero (no hay variantes dentro de un archivo), así que las claves son rutas a secas.
import * as THREE from 'three';
import type { Tint } from './instancing';

const K = (file: string) => `/mega/${file}.glb`;
const P = (file: string) => `/pirate/${file}.glb`;

/** Numera variantes de un mismo modelo: tree, tree-2, tree-3… */
function variants(base: string, n: number, dir = K): string[] {
  const out = [dir(base)];
  for (let i = 2; i <= n; i++) out.push(dir(`${base}-${i}`));
  return out;
}

export const SPECIES = {
  /** Frondoso de copa redonda: el árbol corriente del prado. */
  broadleaf: variants('tree', 5),
  /** El retorcido de copa ancha: el que marca el horizonte y cambia la silueta del bosque. */
  twisted: variants('twisted-tree', 5),
  pine: variants('pine', 5),
  // Ojo: si se añade aquí otra especie sin hojas, hay que meterla en LEAFLESS.
  deadPale: [K('dead-tree'), K('dead-tree-2'), K('dead-tree-3')],
  deadDark: [K('dead-tree-4'), K('dead-tree-5')],
  palm: variants('palm-tree', 3, P),
  rock: [K('rock-medium'), K('rock-medium-2'), K('rock-medium-3')],
  pebble: [...variants('pebble-round', 5), ...variants('pebble-square', 6)],
  slab: [K('rock-path-round-small'), K('rock-path-round-wide'), K('rock-path-square-wide'), K('rock-path-square-thin')],
  grass: [K('grass'), K('grass-wispy'), K('grass-wispy-2'), K('tall-grass')],
  flower: [...variants('flower-petal', 5), K('flower-single'), K('flower-single-2'), K('flower-group'), K('flower-group-2')],
  bush: [K('bush'), K('bush-with-flowers'), K('fern')],
  plant: [K('plant'), K('plant-2'), K('plant-big'), K('plant-big-2'), K('clover'), K('clover-2')],
  mushroom: [K('mushroom'), K('mushroom-laetiporus')],
} as const;

const C = (hex: number) => new THREE.Color(hex);
/**
 * Multiplicador de color libre. Hace falta además de C() porque un hex tope en 1.0 y el tinte multiplica,
 * así que un hex solo puede oscurecer; para subir un canal hay que pasar de 1.
 */
const M = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);

/**
 * Los tintes son multiplicadores sobre el color nativo de la textura del pack, que es un verde medio
 * bastante neutro para el follaje y marrón para la corteza. Eso simplifica la calibración respecto al
 * pack anterior (donde el abedul era dorado y el arce rojizo de fábrica): aquí el color de cada bioma se
 * pinta de verdad con el tinte, y por eso las ruinas pueden ser otoño y el pico, escarcha, con la misma
 * especie plantada en los dos sitios.
 */
export const TINTS: Record<string, Tint[]> = {
  meadow: [{ leaves: M(1, 1.05, 0.95) }, { leaves: M(0.88, 1.02, 1.2) }, { leaves: M(1.12, 1.05, 0.8) }],
  lake: [{ leaves: M(0.85, 1.12, 1.15) }, { leaves: M(0.95, 1.1, 1) }],
  // Bosque profundo: verde frío y oscuro, que es lo que separa el bosque del prado al mirarlos juntos.
  woods: [{ leaves: M(0.6, 0.95, 0.8) }, { leaves: M(0.52, 0.86, 0.95) }, { leaves: M(0.66, 1, 0.72) }],
  // Las ruinas van en otoño: cobre, mostaza y teja sobre corteza clara.
  ruins: [{ leaves: M(1.5, 0.95, 0.45), bark: C(0xb79a74) }, { leaves: M(1.35, 0.7, 0.35), bark: C(0xa98c68) }, { leaves: M(1.45, 1.15, 0.5) }],
  // El pico va escarchado: hoja azulada y corteza lavada, para que se integre con la nieve del suelo.
  peak: [{ leaves: M(0.72, 0.95, 1.5), bark: C(0xcdd7e0) }, { leaves: M(0.66, 0.9, 1.65), bark: C(0xc3ced8) }],
  // El volcán va calcinado por completo, tronco incluido.
  volcano: [{ all: C(0x6d605a) }, { all: C(0x564b46) }],
  // Tormenta: follaje apagado y violeta, como vegetación bajo nube permanente.
  storm: [{ leaves: M(0.8, 0.72, 1.3), bark: C(0x5f5870) }, { leaves: M(0.62, 0.66, 1.2), bark: C(0x4e4860) }],
  // Dunas: todo dorado por el sol bajo del desierto.
  sands: [{ leaves: M(1.35, 1.05, 0.5), bark: C(0xc2a070) }, { leaves: M(1.2, 1, 0.62), bark: C(0xb5956a) }],
  // Cristal: lavado hacia el malva frío de las agujas minerales.
  crystal: [{ leaves: M(0.95, 0.95, 1.6), bark: C(0xc9cfe6) }, { all: C(0xbfc6e2) }],
};

export const ROCK_TINTS: Record<string, Tint> = {
  meadow: { all: C(0xbfc3bd) },
  volcano: { all: C(0x4c4441) },
  peak: { all: C(0xc9dbe8) },
  ruins: { all: C(0xe6dcc0) },
  lake: { all: C(0xeaeadf) },
  woods: { all: C(0x9fae9c) },
  storm: { all: C(0x6e6889) },
  sands: { all: C(0xe8d3a0) },
  crystal: { all: C(0xc3cbe9) },
};

/**
 * Especies sin follaje: los árboles muertos son solo ramas y las piedras no tienen copa, así que no
 * ocultan nada. Registrarlas como copa hacía que la cámara las esquivara para nada.
 */
const LEAFLESS = new Set<string>([...SPECIES.deadPale, ...SPECIES.deadDark, ...SPECIES.rock, ...SPECIES.pebble]);

export const hasFoliage = (key: string): boolean => !LEAFLESS.has(key);

export interface TreeLayer {
  /** Variantes entre las que elegir. */
  species: readonly string[];
  clusters: number;
  perCluster: [number, number];
  /** Radio del bosquecillo, metros. */
  radius: [number, number];
  /** Separación mínima entre troncos, metros. */
  spacing: number;
  /** Altura en metros: el borde del grupo se queda en el mínimo, el núcleo llega al máximo. */
  height: [number, number];
  /** Inclinación máxima en radianes. */
  tilt?: number;
  outline?: number;
}

/**
 * Capas de árboles por bioma. Dos o tres capas (dosel + sotobosque) en los biomas frondosos: es lo que da
 * profundidad, porque un bosque de un solo tamaño se ve como un sello repetido.
 *
 * El `spacing` está calibrado contra el ancho de copa: las copas de este pack miden aproximadamente
 * 0.45 × la altura de ancho, salvo el retorcido, que es casi tan ancho como alto y por eso se siembra
 * suelto y en grupos de uno o dos. Con separación cerca del ancho de copa los grupos se leen como
 * bosquecillos con huecos de luz, y la cámara siempre encuentra por dónde pasar (ver CameraRig.tsx).
 */
export const BIOME_TREES: Record<string, TreeLayer[]> = {
  meadow: [
    { species: SPECIES.broadleaf, clusters: 14, perCluster: [3, 6], radius: [8, 14], spacing: 6.5, height: [7.5, 12], tilt: 0.035 },
    { species: SPECIES.twisted, clusters: 5, perCluster: [1, 2], radius: [7, 12], spacing: 12, height: [13, 17], tilt: 0.02 },
  ],
  lake: [
    { species: SPECIES.palm, clusters: 11, perCluster: [3, 6], radius: [7, 12], spacing: 6, height: [7, 11], tilt: 0.09 },
    { species: SPECIES.broadleaf, clusters: 4, perCluster: [2, 4], radius: [5, 9], spacing: 5.5, height: [6.5, 9.5], tilt: 0.04 },
  ],
  // El bosque sí es bosque: pino apretado y retorcidos sueltos rompiendo la vertical.
  woods: [
    { species: SPECIES.pine, clusters: 18, perCluster: [5, 10], radius: [8, 14], spacing: 5.5, height: [10, 16], tilt: 0.03 },
    { species: SPECIES.twisted, clusters: 6, perCluster: [1, 2], radius: [6, 11], spacing: 13, height: [14, 18], tilt: 0.02 },
    { species: SPECIES.broadleaf, clusters: 7, perCluster: [3, 6], radius: [6, 11], spacing: 5, height: [6, 9.5], tilt: 0.04 },
  ],
  volcano: [
    { species: SPECIES.deadDark, clusters: 12, perCluster: [3, 6], radius: [7, 13], spacing: 5, height: [5.5, 9.5], tilt: 0.1 },
  ],
  peak: [
    { species: SPECIES.pine, clusters: 12, perCluster: [3, 7], radius: [7, 12], spacing: 5.5, height: [6.5, 10.5], tilt: 0.045 },
    { species: SPECIES.deadPale, clusters: 5, perCluster: [2, 4], radius: [5, 9], spacing: 5, height: [5, 8], tilt: 0.09 },
  ],
  // Otoño de las ruinas: retorcidos cobrizos entre frondosos mostaza.
  ruins: [
    { species: SPECIES.twisted, clusters: 7, perCluster: [1, 3], radius: [7, 12], spacing: 11, height: [12, 16], tilt: 0.03 },
    { species: SPECIES.broadleaf, clusters: 8, perCluster: [3, 6], radius: [6, 10], spacing: 5.5, height: [6, 10], tilt: 0.05 },
  ],
  // Meseta de la tormenta: poco árbol y muy inclinado, como crecido contra el viento.
  storm: [
    { species: SPECIES.pine, clusters: 9, perCluster: [2, 5], radius: [6, 11], spacing: 6, height: [6, 10], tilt: 0.14 },
    { species: SPECIES.deadPale, clusters: 7, perCluster: [2, 4], radius: [5, 9], spacing: 5, height: [4.5, 7.5], tilt: 0.17 },
  ],
  // Dunas: palmeras en los oasis y troncos secos clavados en la arena.
  sands: [
    { species: SPECIES.palm, clusters: 10, perCluster: [3, 6], radius: [5, 9], spacing: 5.5, height: [7, 11], tilt: 0.1 },
    { species: SPECIES.deadPale, clusters: 6, perCluster: [2, 4], radius: [6, 10], spacing: 5, height: [4, 6.5], tilt: 0.13 },
  ],
  // Cristal: agujas pálidas y retorcidos helados, el bioma más quieto de la región.
  crystal: [
    { species: SPECIES.pine, clusters: 11, perCluster: [3, 7], radius: [6, 11], spacing: 5.5, height: [7, 12], tilt: 0.03 },
    { species: SPECIES.twisted, clusters: 5, perCluster: [1, 2], radius: [6, 10], spacing: 12, height: [12, 15], tilt: 0.02 },
  ],
};

export interface LandmarkTrees { species: readonly string[]; count: number; height: [number, number] }

/** Árboles sueltos fuera de los grupos: los que rompen la monotonía y marcan el horizonte. */
export const LANDMARK_TREES: Record<string, LandmarkTrees[]> = {
  meadow: [
    { species: SPECIES.broadleaf, count: 8, height: [11, 15] },
    { species: SPECIES.twisted, count: 3, height: [15, 19] },
  ],
  lake: [{ species: SPECIES.palm, count: 6, height: [10, 14] }],
  woods: [{ species: SPECIES.pine, count: 8, height: [15, 20] }],
  ruins: [{ species: SPECIES.twisted, count: 4, height: [14, 18] }],
  peak: [{ species: SPECIES.pine, count: 4, height: [10, 14] }],
  volcano: [{ species: SPECIES.deadDark, count: 5, height: [9, 13] }],
  storm: [{ species: SPECIES.deadPale, count: 5, height: [8, 12] }],
  sands: [{ species: SPECIES.palm, count: 7, height: [11, 15] }],
  crystal: [{ species: SPECIES.twisted, count: 5, height: [13, 17] }],
};

export interface CoverLayer {
  species: readonly string[];
  clusters: number;
  perCluster: [number, number];
  radius: [number, number];
  spacing: number;
  height: [number, number];
  /** Corrección de color propia de la especie, multiplicada sobre la del bioma. Puede pasar de 1. */
  tint?: THREE.Color;
}

/**
 * La hierba del MegaKit ya viene en un verde de pradera correcto, así que el levantón que necesitaba el
 * pack anterior ahora es mínimo: solo un punto de saturación para que no se apague contra el suelo.
 */
export const GRASS_LIFT = new THREE.Color().setRGB(1, 1.1, 1);

/**
 * Cubierta baja: matas de hierba, flores, helechos, setas y cantos rodados. Van agrupadas igual que los
 * árboles porque una pradera con flores repartidas parejo se ve artificial — las flores crecen en manchas.
 */
export const BIOME_COVER: Record<string, CoverLayer[]> = {
  meadow: [
    { species: SPECIES.grass, clusters: 50, perCluster: [8, 18], radius: [2.5, 5.5], spacing: 0.85, height: [0.45, 0.8], tint: GRASS_LIFT },
    { species: SPECIES.flower, clusters: 16, perCluster: [5, 11], radius: [1.6, 3.6], spacing: 0.7, height: [0.3, 0.55] },
    { species: SPECIES.bush, clusters: 8, perCluster: [2, 5], radius: [3, 6], spacing: 2, height: [1, 1.8] },
    { species: SPECIES.plant, clusters: 7, perCluster: [3, 7], radius: [2, 4], spacing: 1, height: [0.4, 0.85] },
    { species: SPECIES.pebble, clusters: 10, perCluster: [3, 7], radius: [2, 5], spacing: 1.2, height: [0.2, 0.45] },
  ],
  lake: [
    { species: SPECIES.grass, clusters: 34, perCluster: [6, 15], radius: [2.5, 5.5], spacing: 0.85, height: [0.45, 0.85], tint: GRASS_LIFT },
    { species: SPECIES.plant, clusters: 14, perCluster: [4, 10], radius: [2, 4.5], spacing: 0.9, height: [0.45, 1] },
    { species: SPECIES.pebble, clusters: 14, perCluster: [4, 9], radius: [2, 5], spacing: 1.1, height: [0.22, 0.5] },
  ],
  woods: [
    { species: SPECIES.grass, clusters: 38, perCluster: [6, 14], radius: [2.5, 5.5], spacing: 0.9, height: [0.4, 0.75], tint: GRASS_LIFT },
    { species: SPECIES.bush, clusters: 16, perCluster: [3, 7], radius: [3, 7], spacing: 1.9, height: [1.1, 2.1] },
    { species: SPECIES.mushroom, clusters: 14, perCluster: [3, 8], radius: [1.5, 3.5], spacing: 0.8, height: [0.3, 0.75] },
    { species: SPECIES.plant, clusters: 12, perCluster: [4, 9], radius: [2, 4.5], spacing: 0.9, height: [0.4, 0.9] },
  ],
  ruins: [
    { species: SPECIES.grass, clusters: 30, perCluster: [6, 14], radius: [2.5, 5.5], spacing: 0.9, height: [0.4, 0.75], tint: GRASS_LIFT },
    { species: SPECIES.flower, clusters: 7, perCluster: [4, 9], radius: [1.6, 3.4], spacing: 0.7, height: [0.28, 0.5] },
    { species: SPECIES.slab, clusters: 12, perCluster: [3, 7], radius: [2, 5], spacing: 1.6, height: [0.18, 0.3] },
    { species: SPECIES.bush, clusters: 9, perCluster: [3, 7], radius: [3, 6], spacing: 1.8, height: [0.9, 1.7] },
  ],
  volcano: [
    { species: SPECIES.pebble, clusters: 18, perCluster: [4, 10], radius: [2.5, 5], spacing: 1, height: [0.25, 0.6] },
    { species: SPECIES.grass, clusters: 8, perCluster: [4, 10], radius: [2.5, 5], spacing: 1, height: [0.3, 0.6] },
  ],
  peak: [
    { species: SPECIES.pebble, clusters: 14, perCluster: [4, 9], radius: [2.5, 5], spacing: 1, height: [0.22, 0.5] },
    { species: SPECIES.grass, clusters: 9, perCluster: [4, 9], radius: [2.5, 5], spacing: 1, height: [0.3, 0.55] },
  ],
  storm: [
    { species: SPECIES.grass, clusters: 20, perCluster: [5, 12], radius: [2.5, 5], spacing: 0.95, height: [0.35, 0.7] },
    { species: SPECIES.pebble, clusters: 16, perCluster: [4, 9], radius: [2, 5], spacing: 1.1, height: [0.25, 0.55] },
    { species: SPECIES.plant, clusters: 8, perCluster: [3, 6], radius: [2, 4], spacing: 1, height: [0.4, 0.8] },
  ],
  sands: [
    { species: SPECIES.grass, clusters: 10, perCluster: [4, 9], radius: [2.5, 5], spacing: 1.1, height: [0.3, 0.6] },
    { species: SPECIES.pebble, clusters: 12, perCluster: [3, 8], radius: [2.5, 6], spacing: 1.3, height: [0.25, 0.6] },
    { species: SPECIES.bush, clusters: 7, perCluster: [2, 4], radius: [3, 6], spacing: 2.2, height: [0.8, 1.5] },
  ],
  crystal: [
    { species: SPECIES.grass, clusters: 14, perCluster: [4, 10], radius: [2.5, 5], spacing: 1, height: [0.3, 0.6] },
    { species: SPECIES.mushroom, clusters: 10, perCluster: [3, 7], radius: [1.5, 3.5], spacing: 0.9, height: [0.35, 0.8] },
    { species: SPECIES.pebble, clusters: 16, perCluster: [4, 9], radius: [2, 5], spacing: 1.1, height: [0.25, 0.55] },
  ],
};

/** La franja de bosque entre biomas (placeAt === null), que antes no tenía ninguna cubierta. */
export const BETWEEN_COVER: CoverLayer[] = [
  { species: SPECIES.grass, clusters: 110, perCluster: [6, 14], radius: [2.5, 5.5], spacing: 0.9, height: [0.4, 0.75], tint: GRASS_LIFT },
  { species: SPECIES.bush, clusters: 26, perCluster: [2, 5], radius: [3, 6], spacing: 2, height: [1, 1.8] },
  { species: SPECIES.plant, clusters: 18, perCluster: [3, 6], radius: [2, 4], spacing: 1, height: [0.4, 0.85] },
  { species: SPECIES.flower, clusters: 12, perCluster: [3, 8], radius: [1.6, 3.4], spacing: 0.75, height: [0.28, 0.5] },
  { species: SPECIES.pebble, clusters: 20, perCluster: [3, 7], radius: [2, 5], spacing: 1.2, height: [0.2, 0.45] },
];

/** Hierba de las manchas de spawn: más alta y más densa que la del prado, sin estirar el modelo. */
export const PATCH_GRASS = { height: [1, 0.75] as [number, number], perCluster: [32, 52] as [number, number], spacing: 0.55 };

/** Tinte de la cubierta baja: la hierba del volcán y del pico no puede ser verde pradera. */
export const COVER_TINTS: Record<string, Tint> = {
  volcano: { all: C(0x8a7468) },
  peak: { all: C(0xd8e8f0) },
  ruins: { all: C(0xe3d9ae) },
  storm: { all: C(0x9d9ab8) },
  sands: { all: C(0xe3d49b) },
  crystal: { all: C(0xd2daf2) },
};

/** Cantidad y tamaño de las rocas por bioma. */
export const BIOME_ROCKS: Record<string, { clusters: number; perCluster: [number, number]; radius: [number, number]; height: [number, number] }> = {
  meadow: { clusters: 9, perCluster: [2, 5], radius: [3, 7], height: [0.6, 1.6] },
  lake: { clusters: 11, perCluster: [2, 6], radius: [3, 8], height: [0.6, 1.8] },
  woods: { clusters: 11, perCluster: [2, 5], radius: [3, 7], height: [0.7, 2] },
  volcano: { clusters: 18, perCluster: [3, 8], radius: [4, 9], height: [0.9, 3] },
  peak: { clusters: 16, perCluster: [3, 7], radius: [4, 9], height: [0.8, 2.6] },
  ruins: { clusters: 10, perCluster: [2, 6], radius: [3, 7], height: [0.7, 2] },
  storm: { clusters: 20, perCluster: [3, 8], radius: [4, 9], height: [1, 3.4] },
  sands: { clusters: 9, perCluster: [2, 5], radius: [4, 9], height: [0.7, 2.2] },
  crystal: { clusters: 22, perCluster: [3, 8], radius: [3, 8], height: [1.1, 3.8] },
};

/** Todas las claves de variante que el mundo necesita precargar. */
export function allStylizedKeys(): string[] {
  const keys = new Set<string>();
  for (const list of Object.values(SPECIES)) for (const k of list) keys.add(k);
  return Array.from(keys);
}
