// Dirección de arte de la región: qué especie crece en cada bioma, de qué altura real, en grupos de qué
// tamaño y con qué paleta. Es el único sitio que hay que tocar para cambiar cómo se ve el mundo.
//
// Todo sale del Ultimate Stylized Nature Pack de Quaternius (CC0), un solo autor y una sola paleta. Esa
// es la razón principal por la que el mundo se lee armónico: antes convivían Kenney (plano, sin textura),
// Cube World (blocky) y el set de parque, tres lenguajes visuales peleados entre sí.
//
// Las alturas están en metros y el avatar mide 1.75, así que se leen directamente. Antes los árboles se
// escalaban con multiplicadores a ojo (2.2×–4.2× sobre el tamaño nativo del GLB), que es lo que los
// dejaba desproporcionados: un multiplicador no dice nada del tamaño que acabas viendo en pantalla.
import * as THREE from 'three';
import type { Tint } from './instancing';

const U = (file: string) => `/stylized/${file}.glb`;

/** Construye claves "url#Nodo" para las variantes numeradas dentro de un GLB del pack. */
function variants(file: string, prefix: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${U(file)}#${prefix}${i}`);
  return out;
}

/** Cada GLB del pack trae varias variantes como nodos hermanos; estas son sus claves. */
export const SPECIES = {
  broadleaf: variants('trees', 'NormalTree_', 1, 5),
  birch: variants('birch', 'BirchTree_', 1, 5),
  maple: variants('maple', 'MapleTree_', 1, 5),
  pine: variants('pine', 'PineTree_', 1, 5),
  palm: variants('palm', 'PalmTree_', 1, 5),
  deadPale: variants('dead-a', 'DeadTree_', 1, 5),
  deadDark: variants('dead-b', 'DeadTree_', 6, 10),
  rock: variants('rocks', 'Rock_', 1, 5),
  // Ojo: si se añade aquí otra especie sin hojas, hay que meterla en LEAFLESS.
  grass: [`${U('grass')}#Grass_Large_Extruded`, `${U('grass')}#Grass_Small`],
  flower: [
    `${U('flowers')}#Flower_1`,
    `${U('flowers')}#Flower_2`,
    `${U('flowers')}#Flower_1_Clump`,
    `${U('flowers')}#Flower_2_Clump`,
    `${U('flowers')}#Flower_3_Clump`,
    `${U('flowers')}#Flower_4_Clump`,
    `${U('flowers')}#Flower_5_Clump`,
  ],
  bush: [`${U('bushes')}#Bush`, `${U('bushes')}#Bush_Flowers`, `${U('bushes')}#Plant_1`],
  plant: [`${U('plants')}#Petals_1`, `${U('plants')}#Plant_2`, `${U('plants')}#Plant_Flowers`],
} as const;

const C = (hex: number) => new THREE.Color(hex);
/**
 * Multiplicador de color libre. Hace falta además de C() porque un hex tope en 1.0 y el tinte multiplica,
 * así que un hex solo puede oscurecer; para subir un canal hay que pasar de 1.
 */
const M = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);

/**
 * Los tintes son multiplicadores sobre el color nativo de cada textura, así que están calibrados contra
 * ese color, no en abstracto. Los colores nativos medios de las hojas del pack son:
 *
 *   broadleaf (126,205,0) verde vivo · birch (232,199,1) DORADO · maple (205,88,62) ROJIZO
 *   pine (173,174,63) oliva amarillento · palm (126,166,49) verde oliva
 *
 * Que el abedul sea dorado y el arce rojizo de fábrica es la razón por la que las especies se reparten
 * como se reparten: el otoño de las ruinas no hay que pintarlo, basta con plantar arce y abedul allí. Y
 * el pino necesita que se le baje el rojo para leerse como bosque en vez de como oliva seco.
 */
export const TINTS: Record<string, Tint[]> = {
  meadow: [{ leaves: M(1, 1, 1) }, { leaves: M(0.9, 1, 1.3) }, { leaves: M(1.1, 1, 0.75) }],
  lake: [{ leaves: M(1, 1.14, 1.5) }, { leaves: M(1.1, 1.12, 1.15) }],
  // Bajar el rojo casi a la mitad convierte el oliva del pino en verde bosque profundo.
  woods: [{ leaves: M(0.5, 0.92, 1) }, { leaves: M(0.58, 1, 0.85) }, { leaves: M(0.45, 0.85, 1.15) }],
  // Las ruinas ya son otoño por especie (arce rojizo, abedul dorado): solo variación tonal.
  ruins: [{ leaves: M(1, 1, 1) }, { leaves: M(1, 1.12, 0.9) }, { leaves: M(0.95, 0.88, 0.85) }],
  // El pico va escarchado: hoja azulada y corteza lavada, para que se integre con la nieve del suelo.
  peak: [{ leaves: M(0.72, 0.95, 1.5), bark: C(0xcdd7e0) }, { leaves: M(0.66, 0.9, 1.65), bark: C(0xc3ced8) }],
  // El volcán va calcinado por completo, tronco incluido.
  volcano: [{ all: C(0x6d605a) }, { all: C(0x564b46) }],
};

export const ROCK_TINTS: Record<string, Tint> = {
  volcano: { all: C(0x4c4441) },
  peak: { all: C(0xc9dbe8) },
  ruins: { all: C(0xe6dcc0) },
  lake: { all: C(0xeaeadf) },
};

/**
 * Especies sin follaje. Los árboles muertos son solo ramas, así que no ocultan nada: registrarlos como
 * copa hacía que la cámara los esquivara para nada, y en el volcán, que es todo árbol muerto, la dejaba
 * esquivando el bioma entero.
 */
const LEAFLESS = new Set<string>([...SPECIES.deadPale, ...SPECIES.deadDark]);

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
 * Capas de árboles por bioma. Dos capas (dosel + sotobosque) en los biomas frondosos: es lo que da
 * profundidad, porque un bosque de un solo tamaño se ve como un sello repetido.
 *
 * El `spacing` está calibrado contra el ancho de copa, no elegido a ojo: las copas de este pack miden
 * aproximadamente 0.6 × la altura de ancho, así que a 4 m de separación un grupo de árboles de 10 m se
 * solapa entero y forma un techo cerrado. Eso tenía dos consecuencias malas: una pradera que parecía
 * selva, y una cámara sin salida — si no hay claro entre copas, no hay sitio donde ponerla que no sea
 * dentro de las hojas (ver CameraRig.tsx). Con separación cerca del ancho de copa los grupos se leen como
 * bosquecillos con huecos de luz, que es lo que se quería, y la cámara siempre encuentra por dónde pasar.
 * Los grupos se compensan siendo más numerosos, para no perder densidad de bosque en el conjunto.
 */
export const BIOME_TREES: Record<string, TreeLayer[]> = {
  meadow: [
    { species: SPECIES.broadleaf, clusters: 15, perCluster: [3, 6], radius: [8, 14], spacing: 7, height: [7.5, 12.5], tilt: 0.035 },
    // Sotobosque del mismo verde que el dosel. Antes aquí iba abedul, y como el abedul del pack es dorado
    // la pradera acababa medio otoñal, peleando con la identidad de las ruinas.
    { species: SPECIES.broadleaf, clusters: 10, perCluster: [2, 5], radius: [6, 10], spacing: 5, height: [5, 7.5], tilt: 0.05 },
  ],
  lake: [
    { species: SPECIES.palm, clusters: 11, perCluster: [3, 6], radius: [7, 12], spacing: 6, height: [8, 13], tilt: 0.08 },
    { species: SPECIES.broadleaf, clusters: 4, perCluster: [2, 4], radius: [5, 9], spacing: 5.5, height: [6.5, 9.5], tilt: 0.04 },
  ],
  // El bosque sí es bosque: se queda con la separación más apretada que su ancho de copa permite, así que
  // aquí la cámara sí acabará entre hojas de vez en cuando. Es el sitio donde eso es correcto.
  woods: [
    { species: SPECIES.pine, clusters: 18, perCluster: [5, 10], radius: [8, 14], spacing: 6.5, height: [11, 17.5], tilt: 0.03 },
    { species: SPECIES.broadleaf, clusters: 8, perCluster: [3, 6], radius: [6, 11], spacing: 5.5, height: [7, 10.5], tilt: 0.04 },
  ],
  volcano: [
    { species: SPECIES.deadDark, clusters: 11, perCluster: [3, 6], radius: [7, 13], spacing: 5, height: [5.5, 9.5], tilt: 0.1 },
  ],
  peak: [
    { species: SPECIES.pine, clusters: 12, perCluster: [3, 7], radius: [7, 12], spacing: 6, height: [6.5, 11], tilt: 0.045 },
    { species: SPECIES.deadPale, clusters: 5, perCluster: [2, 4], radius: [5, 9], spacing: 5, height: [5, 8], tilt: 0.09 },
  ],
  // Arce rojizo y abedul dorado: el otoño de las ruinas sale del color nativo de las dos especies.
  ruins: [
    { species: SPECIES.maple, clusters: 8, perCluster: [3, 6], radius: [7, 12], spacing: 6.5, height: [7.5, 12], tilt: 0.04 },
    { species: SPECIES.birch, clusters: 6, perCluster: [3, 6], radius: [6, 10], spacing: 5.5, height: [6, 9.5], tilt: 0.05 },
  ],
};

export interface LandmarkTrees { species: readonly string[]; count: number; height: [number, number] }

/**
 * Árboles sueltos fuera de los grupos: los que rompen la monotonía y marcan el horizonte. Es una lista por
 * bioma para poder meter acentos de otra especie — los tres abedules dorados de la pradera son eso: unos
 * pocos puntos cálidos entre tanto verde, sin llegar a volver otoñal el bioma.
 */
export const LANDMARK_TREES: Record<string, LandmarkTrees[]> = {
  meadow: [
    { species: SPECIES.broadleaf, count: 9, height: [11, 16] },
    { species: SPECIES.birch, count: 3, height: [9, 13] },
  ],
  lake: [{ species: SPECIES.palm, count: 6, height: [11, 15] }],
  woods: [{ species: SPECIES.pine, count: 8, height: [16, 22] }],
  ruins: [{ species: SPECIES.maple, count: 5, height: [11, 15] }],
  peak: [{ species: SPECIES.pine, count: 4, height: [10, 14] }],
  volcano: [{ species: SPECIES.deadDark, count: 5, height: [9, 13] }],
};

export interface CoverLayer {
  species: readonly string[];
  clusters: number;
  perCluster: [number, number];
  radius: [number, number];
  spacing: number;
  height: [number, number];
  /**
   * Corrección de color propia de la especie, multiplicada sobre la del bioma. Puede pasar de 1 para
   * aclarar. La hierba del pack la necesita: su textura promedia un oliva apagado (RGB 87,108,31) que
   * junto al verde del terreno se lee como hierba seca en vez de pradera.
   */
  tint?: THREE.Color;
}

/**
 * Aclara y satura la hierba hacia verde pradera sin perder la variación de su textura.
 *
 * Se construye con setRGB y no con un hex a propósito: un color hexadecimal tope en 1.0 y el tinte es un
 * multiplicador, así que un hex solo puede oscurecer. Para subir el verde y el azul hay que pasar de 1.
 */
export const GRASS_LIFT = new THREE.Color().setRGB(1.05, 1.4, 1.5);

/**
 * Cubierta baja: matas de hierba, flores y arbustos. Van agrupadas igual que los árboles porque una
 * pradera con flores repartidas parejo se ve artificial — las flores crecen en manchas.
 */
export const BIOME_COVER: Record<string, CoverLayer[]> = {
  // Menos manchas y más separadas: con 90+40 la pradera no tenía un metro de suelo limpio y todo competía
  // por la mirada. Pocas manchas de flores bien puestas se leen mejor que muchas repartidas.
  meadow: [
    { species: SPECIES.grass, clusters: 52, perCluster: [8, 18], radius: [2.5, 5.5], spacing: 0.85, height: [0.4, 0.75], tint: GRASS_LIFT },
    { species: SPECIES.flower, clusters: 16, perCluster: [5, 11], radius: [1.6, 3.6], spacing: 0.7, height: [0.35, 0.65] },
    { species: SPECIES.bush, clusters: 7, perCluster: [2, 5], radius: [3, 6], spacing: 2, height: [0.9, 1.7] },
    { species: SPECIES.plant, clusters: 6, perCluster: [3, 7], radius: [2, 4], spacing: 1, height: [0.4, 0.85] },
  ],
  lake: [
    { species: SPECIES.grass, clusters: 36, perCluster: [6, 15], radius: [2.5, 5.5], spacing: 0.85, height: [0.4, 0.8], tint: GRASS_LIFT },
    { species: SPECIES.plant, clusters: 14, perCluster: [4, 10], radius: [2, 4.5], spacing: 0.9, height: [0.45, 1] },
    { species: SPECIES.bush, clusters: 8, perCluster: [2, 6], radius: [3, 6], spacing: 1.8, height: [0.8, 1.6] },
  ],
  woods: [
    { species: SPECIES.grass, clusters: 42, perCluster: [6, 14], radius: [2.5, 5.5], spacing: 0.9, height: [0.38, 0.72], tint: GRASS_LIFT },
    { species: SPECIES.bush, clusters: 14, perCluster: [3, 7], radius: [3, 7], spacing: 1.9, height: [1, 2] },
    { species: SPECIES.plant, clusters: 12, perCluster: [4, 9], radius: [2, 4.5], spacing: 0.9, height: [0.4, 0.9] },
  ],
  ruins: [
    { species: SPECIES.grass, clusters: 32, perCluster: [6, 14], radius: [2.5, 5.5], spacing: 0.9, height: [0.38, 0.72], tint: GRASS_LIFT },
    { species: SPECIES.flower, clusters: 7, perCluster: [4, 9], radius: [1.6, 3.4], spacing: 0.7, height: [0.3, 0.55] },
    { species: SPECIES.bush, clusters: 10, perCluster: [3, 7], radius: [3, 6], spacing: 1.8, height: [0.8, 1.6] },
  ],
  volcano: [
    { species: SPECIES.grass, clusters: 10, perCluster: [4, 10], radius: [2.5, 5], spacing: 1, height: [0.3, 0.6] },
  ],
  peak: [
    { species: SPECIES.grass, clusters: 10, perCluster: [4, 9], radius: [2.5, 5], spacing: 1, height: [0.28, 0.55] },
  ],
};

/** La franja de bosque entre biomas (placeAt === null), que antes no tenía ninguna cubierta. */
export const BETWEEN_COVER: CoverLayer[] = [
  { species: SPECIES.grass, clusters: 110, perCluster: [6, 14], radius: [2.5, 5.5], spacing: 0.9, height: [0.38, 0.72], tint: GRASS_LIFT },
  { species: SPECIES.bush, clusters: 26, perCluster: [2, 5], radius: [3, 6], spacing: 2, height: [0.9, 1.7] },
  { species: SPECIES.plant, clusters: 18, perCluster: [3, 6], radius: [2, 4], spacing: 1, height: [0.4, 0.85] },
  { species: SPECIES.flower, clusters: 12, perCluster: [3, 8], radius: [1.6, 3.4], spacing: 0.75, height: [0.3, 0.55] },
];

/**
 * Hierba de las manchas de spawn: más alta y más densa que la del prado, pero sin estirar el modelo.
 * Estirar la mata 2.6× para llegar al metro y medio la dejaba espigada y oscura; sale mucho mejor con la
 * mata casi a su tamaño natural y el doble de densidad.
 */
export const PATCH_GRASS = { height: [0.95, 0.72] as [number, number], perCluster: [32, 52] as [number, number], spacing: 0.55 };

/** Tinte de la cubierta baja: la hierba del volcán y del pico no puede ser verde pradera. */
export const COVER_TINTS: Record<string, Tint> = {
  volcano: { all: C(0x8a7468) },
  peak: { all: C(0xd8e8f0) },
  ruins: { all: C(0xeae3bc) },
};

/** Cantidad y tamaño de las rocas por bioma. */
export const BIOME_ROCKS: Record<string, { clusters: number; perCluster: [number, number]; radius: [number, number]; height: [number, number] }> = {
  meadow: { clusters: 8, perCluster: [2, 5], radius: [3, 7], height: [0.5, 1.4] },
  lake: { clusters: 10, perCluster: [2, 6], radius: [3, 8], height: [0.5, 1.6] },
  woods: { clusters: 10, perCluster: [2, 5], radius: [3, 7], height: [0.6, 1.8] },
  volcano: { clusters: 18, perCluster: [3, 8], radius: [4, 9], height: [0.8, 2.8] },
  peak: { clusters: 16, perCluster: [3, 7], radius: [4, 9], height: [0.7, 2.4] },
  ruins: { clusters: 10, perCluster: [2, 6], radius: [3, 7], height: [0.6, 1.8] },
};

/** Todas las claves de variante que el mundo necesita precargar. */
export function allStylizedKeys(): string[] {
  const keys = new Set<string>();
  for (const list of Object.values(SPECIES)) for (const k of list) keys.add(k);
  return Array.from(keys);
}
