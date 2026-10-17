// Colocación agrupada. El muestreo por rechazo uniforme de terrain.scatterIn reparte los props con
// densidad constante, y eso a la vista lee como confeti: un campo parejo de objetos sin bosques, sin
// claros y sin jerarquía. La naturaleza se agrupa, así que aquí sembramos núcleos y colgamos miembros
// alrededor con caída de densidad.
//
// Cada punto sale con dos números que el llamador usa para dar jerarquía:
//   d — distancia normalizada al núcleo del grupo (0 = centro). El centro se lleva el ejemplar grande,
//       el borde los pequeños, y así el grupo tiene silueta en vez de ser una mancha uniforme.
//   t — aleatorio 0..1 estable, para elegir variante y bucket de tinte.
import { rng } from './noise';

export interface Bounds { x0: number; x1: number; z0: number; z1: number }

export interface ScatterPoint {
  x: number;
  z: number;
  /** Rotación en Y, radianes. */
  r: number;
  /** Aleatorio estable 0..1 para elegir variante/tinte. */
  t: number;
  /** 0 en el núcleo del grupo, 1 en su borde. */
  d: number;
}

/**
 * Rejilla de ocupación para exigir separación mínima sin comparar contra todos los puntos ya puestos.
 * La celda mide `spacing`, así que basta revisar las 9 celdas vecinas.
 */
class SpacingGrid {
  private cells = new Map<number, { x: number; z: number }[]>();
  constructor(private spacing: number) {}

  private index(cx: number, cz: number) { return (cz + 4096) * 8192 + (cx + 4096); }

  fits(x: number, z: number, spacing = this.spacing): boolean {
    if (spacing <= 0) return true;
    const cx = Math.floor(x / this.spacing);
    const cz = Math.floor(z / this.spacing);
    const min2 = spacing * spacing;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.cells.get(this.index(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const p of bucket) {
          const ex = p.x - x, ez = p.z - z;
          if (ex * ex + ez * ez < min2) return false;
        }
      }
    }
    return true;
  }

  add(x: number, z: number) {
    const key = this.index(Math.floor(x / this.spacing), Math.floor(z / this.spacing));
    const bucket = this.cells.get(key);
    if (bucket) bucket.push({ x, z }); else this.cells.set(key, [{ x, z }]);
  }
}

export interface ClusterOptions {
  /** Cuántos grupos sembrar. */
  clusters: number;
  /** Miembros por grupo, [min, max]. */
  perCluster: [number, number];
  /** Radio del grupo en metros, [min, max]. */
  radius: [number, number];
  /** Separación mínima entre miembros, en metros. */
  spacing: number;
  /** Sitio válido: caminable, fuera de caminos/agua, en el bioma correcto. */
  test: (x: number, z: number) => boolean;
  bounds: Bounds;
  /**
   * Exponente de la caída de densidad hacia el borde. >1 concentra hacia el núcleo.
   * 2 da grupos de centro denso y borde deshilachado, que es lo que se lee como bosque.
   */
  falloff?: number;
}

/** Siembra grupos y devuelve sus miembros, ya filtrados por `test` y con separación mínima respetada. */
export function scatterClusters(seed: number, opts: ClusterOptions): ScatterPoint[] {
  const { clusters, perCluster, radius, spacing, test, bounds, falloff = 2 } = opts;
  const R = rng(seed);
  const grid = new SpacingGrid(Math.max(0.5, spacing));
  const out: ScatterPoint[] = [];

  for (let c = 0; c < clusters; c++) {
    // Buscar un núcleo válido. Si la región está casi llena el presupuesto evita el bucle infinito.
    let cx = 0, cz = 0, found = false;
    for (let attempt = 0; attempt < 120 && !found; attempt++) {
      cx = bounds.x0 + R() * (bounds.x1 - bounds.x0);
      cz = bounds.z0 + R() * (bounds.z1 - bounds.z0);
      if (test(cx, cz)) found = true;
    }
    if (!found) continue;

    const rad = radius[0] + R() * (radius[1] - radius[0]);
    const want = Math.round(perCluster[0] + R() * (perCluster[1] - perCluster[0]));
    // El grupo se deforma en una elipse orientada al azar: los grupos circulares perfectos se notan.
    const stretch = 0.6 + R() * 0.8;
    const axis = R() * Math.PI;
    const cos = Math.cos(axis), sin = Math.sin(axis);

    let placed = 0;
    for (let attempt = 0; attempt < want * 14 && placed < want; attempt++) {
      // sqrt() daría densidad uniforme en el disco; el exponente mayor la empuja hacia el centro.
      const u = Math.pow(R(), falloff / 2);
      const ang = R() * Math.PI * 2;
      const lx = Math.cos(ang) * u * rad;
      const lz = Math.sin(ang) * u * rad * stretch;
      const x = cx + lx * cos - lz * sin;
      const z = cz + lx * sin + lz * cos;
      if (!test(x, z)) continue;
      if (!grid.fits(x, z, spacing)) continue;
      grid.add(x, z);
      out.push({ x, z, r: R() * Math.PI * 2, t: R(), d: Math.min(1, u) });
      placed++;
    }
  }
  return out;
}

export interface SinglesOptions {
  count: number;
  spacing: number;
  test: (x: number, z: number) => boolean;
  bounds: Bounds;
}

/** Ejemplares sueltos, con separación mínima: para los árboles aislados que rompen la monotonía. */
export function scatterSingles(seed: number, opts: SinglesOptions): ScatterPoint[] {
  const { count, spacing, test, bounds } = opts;
  const R = rng(seed);
  const grid = new SpacingGrid(Math.max(0.5, spacing));
  const out: ScatterPoint[] = [];
  for (let attempt = 0; attempt < count * 60 && out.length < count; attempt++) {
    const x = bounds.x0 + R() * (bounds.x1 - bounds.x0);
    const z = bounds.z0 + R() * (bounds.z1 - bounds.z0);
    if (!test(x, z)) continue;
    if (!grid.fits(x, z, spacing)) continue;
    grid.add(x, z);
    out.push({ x, z, r: R() * Math.PI * 2, t: R(), d: 0 });
  }
  return out;
}
