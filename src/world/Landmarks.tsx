// Los lugares construidos de la región: no vegetación repartida por una función, sino conjuntos puestos
// a mano — un embarcadero pirata, un puerto de dunas, unas ruinas de mazmorra, un fuerte en la meseta.
//
// Esto es lo que hace que cada isla se reconozca de lejos y lo que separa este mundo del anterior, que
// era solo bioma + coliseo. Cada sitio se escribe en coordenadas LOCALES (el eje −x mira "al frente" del
// conjunto) y luego se gira y se planta sobre el terreno, igual que los coliseos.
//
// Los packs: Modular Dungeons y Pirate Kit (Quaternius / Kenney vía poly.pizza, CC0). Se instancian por
// modelo, así que un fuerte de 30 piezas son unas pocas llamadas de dibujo.
import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { heightAt, WATER_Y, BUILT, type BuiltSite } from './terrain';
import { loadVariantSet, type ModelSet } from './modelLoader';
import { toonFromMaterial } from './toon';

const D = (f: string) => `/dungeon/${f}.glb`;
const P = (f: string) => `/pirate/${f}.glb`;
const K = (f: string) => `/mega/${f}.glb`;

interface Prop {
  url: string;
  /** Posición local: x hacia el frente del conjunto, z a los lados. */
  x: number;
  z: number;
  /** Giro en Y, radianes. */
  r?: number;
  /** Tamaño en metros de la dimensión mayor del modelo. */
  size: number;
  /** Vuelco: un ángulo en X (columna caída, barco escorado). */
  tilt?: number;
  /** Altura extra sobre el suelo, metros. */
  lift?: number;
  /** Se apoya en la lámina de agua y no en el terreno (embarcaderos, barcos). */
  water?: boolean;
}

/** Anillo de piezas repetidas: muros de un fuerte, columnas de un templo. */
function ring(url: string, n: number, radius: number, size: number, opts: { from?: number; faceOut?: boolean; skip?: number[]; tilt?: (i: number) => number } = {}): Prop[] {
  const out: Prop[] = [];
  for (let i = 0; i < n; i++) {
    if (opts.skip?.includes(i)) continue;
    const a = (opts.from ?? 0) + (i / n) * Math.PI * 2;
    out.push({
      url, size,
      x: Math.cos(a) * radius,
      z: Math.sin(a) * radius,
      r: opts.faceOut === false ? 0 : -a + Math.PI / 2,
      tilt: opts.tilt?.(i),
    });
  }
  return out;
}

/** Rejilla de losas: el suelo de piedra de un templo o de una mazmorra a cielo abierto. */
function floor(url: string, cols: number, rows: number, step: number, size: number): Prop[] {
  const out: Prop[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      out.push({ url, size, x: (i - (cols - 1) / 2) * step, z: (j - (rows - 1) / 2) * step, r: ((i + j) % 2) * Math.PI / 2 });
    }
  }
  return out;
}

/** Las piezas de cada conjunto, en coordenadas locales. La clave es la del sitio en terrain.BUILT. */
const PROPS: Record<string, Prop[]> = {
  // ---------------------------------------------------------------- Caleta Pirata (orilla este del lago)
  // El frente (−x) mira al agua: los pantalanes salen hacia el lago y el barco queda amarrado al final.
    cove: [
      { url: P('dock'), x: -4, z: 0, size: 4.2, water: true },
      { url: P('dock'), x: -8, z: 0, size: 4.2, water: true },
      { url: P('dock'), x: -12, z: 0, size: 4.2, water: true },
      { url: P('dock-broken'), x: -16, z: 0, size: 4.2, water: true },
      { url: P('dock'), x: -8, z: 4, size: 4.2, water: true },
      { url: P('small-ship'), x: -13, z: 7.5, r: 0.5, size: 9, water: true, lift: -0.4 },
      { url: P('post'), x: -3, z: 2.2, size: 2 },
      { url: P('post'), x: -3, z: -2.2, size: 2 },
      { url: P('anchor'), x: 1.5, z: -3.4, r: 0.7, size: 1.9, tilt: 1.2 },
      { url: P('barrel'), x: 2.2, z: 1.4, size: 1 },
      { url: P('barrel'), x: 2.9, z: 2.1, size: 1 },
      { url: P('barrel'), x: 2.4, z: 2.6, r: 0.6, size: 1, lift: 0.75 },
      { url: P('wood'), x: 3.6, z: -1.2, r: 0.3, size: 2.2 },
      { url: P('chest-closed'), x: 1.8, z: 3.6, r: -0.4, size: 1.1 },
      { url: P('bucket-of-fish'), x: 0.8, z: 2.8, size: 0.8 },
      { url: P('sawmill'), x: 6.5, z: -4.5, r: 1.2, size: 6 },
      { url: P('rocks'), x: -2, z: -6, size: 3.4 },
      { url: P('rocks-2'), x: 4.5, z: 5.5, size: 3 },
      { url: P('rock-3'), x: -6, z: -5.5, size: 2.2, water: true },
      { url: P('palm-tree'), x: 5, z: 4, size: 7 },
      { url: P('palm-tree-2'), x: 7, z: 1.5, size: 8 },
      { url: P('palm-tree-3'), x: 4.5, z: -6, size: 6.5 },
      { url: P('skeleton'), x: 8.5, z: 3, r: 2.2, size: 1.8 },
  ],

  // ---------------------------------------------------------------- Puerto de las Dunas (isla de arena)
    port: [
      { url: P('house'), x: 0, z: -6, r: 0.2, size: 9 },
      { url: P('house-2'), x: 5, z: 2, r: -1.1, size: 8.5 },
      { url: P('house-3'), x: -4, z: 7, r: 0.6, size: 8 },
      { url: P('ship'), x: -14, z: -2, r: 0.4, size: 16, tilt: 0.22 },
      { url: P('cannon'), x: -7, z: -8, r: -0.5, size: 2.4 },
      { url: P('cannon'), x: -8.5, z: -6, r: -0.3, size: 2.4 },
      { url: P('anchor'), x: -6, z: 5, r: 1.1, size: 2.2, tilt: 1.4 },
      { url: P('barrel'), x: 2, z: -2.5, size: 1 },
      { url: P('barrel'), x: 2.8, z: -3.1, size: 1 },
      { url: P('barrel'), x: 2.3, z: -2.8, size: 1, lift: 0.75 },
      { url: P('chest-gold'), x: -2, z: -3.5, r: 0.8, size: 1.2 },
      { url: P('gold-bag'), x: -2.9, z: -2.7, size: 0.7 },
      { url: P('post'), x: -10, z: 3, size: 2.4 },
      { url: P('wood'), x: 1, z: 5.5, r: 1.1, size: 2.4 },
      { url: P('palm-tree'), x: 8, z: -4, size: 8 },
      { url: P('palm-tree-2'), x: 9.5, z: 4.5, size: 9 },
      { url: P('palm-tree-3'), x: 3.5, z: 10, size: 7.5 },
      { url: P('rocks-3'), x: -12, z: 8, size: 3.6 },
      { url: P('rocks-4'), x: 11, z: -8, size: 3 },
      { url: P('pirate-captain'), x: -1.5, z: 1.5, r: -2.1, size: 1.9 },
      { url: P('shark'), x: -18, z: -6, r: 0.9, size: 3.4, tilt: 0.3 },
  ],

  // ---------------------------------------------------------------- Ruinas de Cristal (mazmorra a cielo abierto)
    crypt: [
      ...floor(D('floor-tile'), 4, 4, 3.1, 3.2).map((t) => ({ ...t, lift: -0.35 })),
      ...ring(D('column'), 8, 7.2, 4.4, { skip: [6], tilt: (i) => (i === 2 ? 1.45 : 0) }),
      { url: D('arch'), x: -8.4, z: 0, r: Math.PI / 2, size: 4.6 },
      { url: D('arch-door'), x: 8.4, z: 0, r: Math.PI / 2, size: 4.6 },
      { url: D('wall-modular'), x: 0, z: -8.6, size: 3, r: 0 },
      { url: D('wall-modular'), x: 3.1, z: -8.6, size: 3, r: 0 },
      { url: D('wall-modular'), x: -3.1, z: -8.6, size: 3, r: 0, tilt: 0.5 },
      { url: D('wall-modular'), x: 0, z: 8.6, size: 3, r: Math.PI },
      { url: D('wall-modular'), x: 3.1, z: 8.6, size: 3, r: Math.PI, tilt: -0.4 },
      { url: D('pedestal'), x: 0, z: 0, size: 2.6 },
      { url: D('horse-statue'), x: 0, z: 0, size: 4.2, lift: 2.1 },
      { url: D('pedestal-2'), x: -4.5, z: 4.5, size: 2.2 },
      { url: D('chest-with-gold'), x: -4.5, z: 4.5, size: 1.3, lift: 1.7 },
      { url: D('chest'), x: 4.8, z: -4.2, r: 0.5, size: 1.3 },
      { url: D('coin-piles'), x: 4, z: -3.4, size: 0.9 },
      { url: D('skull'), x: -2.4, z: -5.6, r: 1.2, size: 0.6 },
      { url: D('skull'), x: 5.6, z: 2.4, r: -0.6, size: 0.6 },
      { url: D('bricks'), x: -6.5, z: -6.5, r: 0.7, size: 2 },
      { url: D('bricks'), x: 6.8, z: 6.2, r: -0.3, size: 2 },
      { url: D('torch'), x: -8.2, z: 2.2, size: 1.6, lift: 1.4 },
      { url: D('torch'), x: -8.2, z: -2.2, size: 1.6, lift: 1.4 },
      { url: D('torch'), x: 8.2, z: 2.2, size: 1.6, lift: 1.4 },
      { url: D('torch'), x: 8.2, z: -2.2, size: 1.6, lift: 1.4 },
      { url: D('banner'), x: -2.2, z: -8.4, size: 2.6, lift: 1.6 },
      { url: D('banner'), x: 2.2, z: 8.4, r: Math.PI, size: 2.6, lift: 1.6 },
  ],

  // ---------------------------------------------------------------- Fuerte del Trueno (meseta de la tormenta)
    fort: [
      ...ring(D('wall-modular'), 14, 9, 3.2, { skip: [0, 1, 13] }),
      ...ring(D('column'), 4, 6, 4.2, { from: 0.8 }),
      { url: D('arch-door'), x: 9, z: 0, r: Math.PI / 2, size: 4.8 },
      { url: D('pedestal'), x: 0, z: 0, size: 2.8 },
      { url: D('sword-wall-mount'), x: 0, z: 0, size: 2, lift: 2.2 },
      { url: D('torch'), x: 6.5, z: 3, size: 1.7, lift: 1.5 },
      { url: D('torch'), x: 6.5, z: -3, size: 1.7, lift: 1.5 },
      { url: D('torch'), x: -6, z: 0, size: 1.7, lift: 1.5 },
      { url: D('banner-wall'), x: -8.6, z: 2.6, r: -Math.PI / 2, size: 2.8, lift: 1.4 },
      { url: D('banner-wall'), x: -8.6, z: -2.6, r: -Math.PI / 2, size: 2.8, lift: 1.4 },
      { url: D('crate'), x: 4, z: 5, r: 0.4, size: 1.1 },
      { url: D('crate'), x: 4.9, z: 5.6, r: -0.2, size: 1.1 },
      { url: D('barrel'), x: 3.2, z: 6, size: 1.1 },
      { url: D('table-big'), x: -3.5, z: 4.5, r: 0.3, size: 2.6 },
      { url: D('chair'), x: -5, z: 4.2, r: 1.5, size: 1.3 },
      { url: D('skull'), x: -4.6, z: -5.2, r: 0.9, size: 0.7 },
      { url: D('cobweb'), x: 8.2, z: -4.6, size: 2 },
  ],

  // ---------------------------------------------------------------- Templo Caído (Ruinas Antiguas)
    temple: [
      ...floor(D('floor-tile'), 3, 5, 3.1, 3.2).map((t) => ({ ...t, lift: -0.35 })),
      ...ring(D('column'), 10, 6.4, 4.6, { tilt: (i) => (i === 4 ? 1.5 : i === 7 ? -1.4 : 0) }),
      { url: D('arch'), x: 0, z: -9.5, size: 5 },
      { url: D('arch'), x: 0, z: 9.5, size: 5, tilt: 0.3 },
      { url: D('pedestal-2'), x: 0, z: 0, size: 2.4 },
      { url: D('coin-bag'), x: 0, z: 0, size: 0.8, lift: 1.9 },
      { url: D('bricks'), x: -5.5, z: -7, r: 0.5, size: 2.2 },
      { url: D('bricks'), x: 5.2, z: 6.4, r: -0.8, size: 2.2 },
      { url: D('bricks'), x: 6.4, z: -5.2, r: 1.4, size: 2 },
      { url: D('small-table'), x: -3.4, z: 3.2, r: 0.6, size: 1.6 },
      { url: D('bucket'), x: -4.2, z: 2.4, size: 0.8 },
      { url: D('torch'), x: -6.8, z: -1.8, size: 1.7, lift: 1.3 },
      { url: D('torch'), x: 6.8, z: 1.8, size: 1.7, lift: 1.3 },
      { url: K('twisted-tree'), x: -8.5, z: 6.5, r: 0.8, size: 16 },
  ],

  // ---------------------------------------------------------------- Círculo del Bosque (Deepwood)
    grove: [
      ...ring(D('column'), 6, 5.2, 3.8, { tilt: (i) => (i === 3 ? 1.4 : 0) }),
      { url: D('pedestal'), x: 0, z: 0, size: 2.4 },
      { url: D('skull'), x: 0, z: 0, size: 0.8, lift: 1.9 },
      { url: D('floor-tile'), x: 0, z: 0, size: 6, lift: -0.1 },
      { url: K('mushroom-laetiporus'), x: -3.2, z: 2.6, size: 2.4 },
      { url: K('mushroom'), x: 3.6, z: -2.2, size: 2 },
      { url: K('mushroom'), x: 4.2, z: -1.2, size: 1.4 },
      { url: K('mushroom-laetiporus'), x: 2.2, z: 4.4, size: 1.8 },
      { url: K('rock-medium'), x: -5.5, z: -4.5, size: 3 },
      { url: K('rock-medium-2'), x: 6, z: 4, size: 2.6 },
      { url: K('fern'), x: -4.4, z: 4.6, size: 3.4 },
      { url: K('fern'), x: 5, z: -5, size: 3 },
  ],
};

/**
 * Tinte de cada conjunto. Los dos packs traen su propio color (la mazmorra es piedra casi negra, el
 * pirata es madera cálida) y puestos tal cual se leen como piezas pegadas de otro juego. Teñirlos por
 * sitio es lo que los integra en su isla: la cripta en el lila frío del cristal, el fuerte en pizarra
 * violeta, el templo en arenisca. Es un multiplicador sobre el color nativo, así que conserva el
 * sombreado y las partes claras/oscuras de la textura.
 */
const SITE_TINT: Record<string, THREE.Color> = {
  crypt: new THREE.Color(0xa9b4d8),
  fort: new THREE.Color(0x9f98c4),
  temple: new THREE.Color(0xd8c9a0),
  grove: new THREE.Color(0x9fb79a),
};

/** Coloca un punto local del conjunto en el mundo (deshace el giro del sitio). */
function toWorld(site: BuiltSite, x: number, z: number): [number, number] {
  const c = Math.cos(site.rot), s = Math.sin(site.rot);
  return [site.x + x * c + z * s, site.z - x * s + z * c];
}

interface Placed { url: string; site: string; m: THREE.Matrix4 }

function buildSite(site: BuiltSite, models: Map<string, ModelSet>): Placed[] {
  const out: Placed[] = [];
  const dummy = new THREE.Object3D();
  for (const p of PROPS[site.key] ?? []) {
    const set = models.get(p.url);
    if (!set) continue;
    const largest = Math.max(set.size.x, set.size.y, set.size.z);
    const s = largest > 1e-4 ? p.size / largest : 1;
    const [wx, wz] = toWorld(site, p.x, p.z);
    // El GLB puede traer su origen en el centro y no en la base (los pantalanes bajan 2 m por las patas):
    // restar la base escalada es lo que deja cualquier pieza apoyada en el suelo y no enterrada.
    // Las piezas de agua (pantalanes, barcos) se apoyan en la lámina y NO se compensan por su base: sus
    // patas y su casco están modelados para quedar sumergidos, así que restarles la base las dejaría
    // flotando metros por encima del agua. Las de tierra sí, que es lo que las deja apoyadas y no enterradas.
    const y = p.water ? WATER_Y + (p.lift ?? 0) : heightAt(wx, wz) - set.base * s + (p.lift ?? 0);
    dummy.position.set(wx, y, wz);
    // El giro del sitio se suma al de la pieza: toWorld ya gira la posición, y la orientación tiene que
    // girar con ella o el conjunto queda colocado en arco pero mirando todo al mismo sitio.
    dummy.rotation.set(p.tilt ?? 0, (p.r ?? 0) + site.rot, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    out.push({ url: p.url, site: site.key, m: dummy.matrix.clone() });
  }
  return out;
}

export const Landmarks: React.FC = () => {
  const urls = useMemo(() => Array.from(new Set(Object.values(PROPS).flat().map((p) => p.url))), []);
  const [models, setModels] = useState<Map<string, ModelSet> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadVariantSet(urls)
      .then((m) => { if (!cancelled) setModels(m); })
      .catch((err) => console.error('[landmarks] fallo al cargar modelos', err));
    return () => { cancelled = true; };
  }, [urls]);

  const meshes = useMemo(() => {
    if (!models) return [];
    // Agrupado por (modelo, sitio): un mismo barril en dos sitios con tintes distintos son dos grupos.
    const byGroup = new Map<string, { url: string; site: string; mats: THREE.Matrix4[] }>();
    for (const site of BUILT) {
      for (const placed of buildSite(site, models)) {
        const gk = `${placed.url}@${placed.site}`;
        const g = byGroup.get(gk);
        if (g) g.mats.push(placed.m);
        else byGroup.set(gk, { url: placed.url, site: placed.site, mats: [placed.m] });
      }
    }
    const out: THREE.InstancedMesh[] = [];
    for (const { url, site, mats } of byGroup.values()) {
      const set = models.get(url);
      if (!set) continue;
      const tint = SITE_TINT[site];
      for (const part of set.parts) {
        const material = tint ? toonFromMaterial(part.material, { tint }) : part.material;
        const im = new THREE.InstancedMesh(part.geometry, material, mats.length);
        im.castShadow = true;
        im.receiveShadow = true;
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        out.push(im);
      }
    }
    return out;
  }, [models]);

  return <group>{meshes.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
