import React, { useMemo } from 'react';
import * as THREE from 'three';
import { heightAt, placeAt, around, PLACES, PATCHES, inPatch, pathDist, WATER_Y, ell, dist, LAKE, POND, inLava, ARENA, COLISEUM } from './terrain';
import { scatterClusters } from './scatter';
import { SPECIES, BIOME_COVER, BETWEEN_COVER, COVER_TINTS, GRASS_LIFT, PATCH_GRASS } from './stylized';
import type { Tint } from './instancing';
import { useStylizedInstances, type Seed } from './useStylized';

// Cubierta baja: matas de hierba, flores, arbustos y plantas. Sustituye a Flowers.tsx, que repartía
// flores con densidad uniforme por todo el bioma — y las flores no crecen así, crecen en manchas.
//
// Además le da lectura visual a las zonas de hierba alta (PATCHES en terrain.ts), que son las casillas
// donde van a aparecer los monstruos. Que se vean claramente más densas y altas que el resto del prado
// no es decorativo: es la señal de "aquí se caza" del bucle de PokeGrass.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Sitio válido para cubierta baja: tolera estar más cerca de los caminos que un árbol. */
function coverFits(x: number, z: number): boolean {
  if (heightAt(x, z) < WATER_Y + 0.2) return false;
  if (pathDist(x, z) < 1.3) return false;
  if (ell(x, z, LAKE) < 1.04) return false;
  if (dist(x, z, POND) < POND.r + 0.7) return false;
  if (inLava(x, z, 0.8)) return false;
  if (dist(x, z, ARENA) < COLISEUM.wall + 2.5) return false;
  return true;
}

/**
 * Compone la corrección de color de la especie con la del bioma en un solo multiplicador. Se usa el
 * canal `all` y no `leaves` porque los materiales de la cubierta baja se llaman `Grass` y `Flowers`, y
 * `Flowers` sí encajaría en la regla de hojas mientras `Grass` no — mezclar los dos canales haría que la
 * misma capa se tiñera o no según la especie que le tocara.
 */
function composeTint(layerTint: THREE.Color | undefined, biomeTint: Tint | undefined): Tint | undefined {
  const biome = biomeTint?.all;
  if (!layerTint && !biome) return undefined;
  const color = new THREE.Color(1, 1, 1);
  if (layerTint) color.multiply(layerTint);
  if (biome) color.multiply(biome);
  return { all: color };
}

function biomeSeeds(biome: string): Seed[] {
  const layers = BIOME_COVER[biome];
  if (!layers) return [];
  const place = PLACES[biome];
  const bounds = around(biome, place.r * 1.05);
  const biomeTint = COVER_TINTS[biome];
  const out: Seed[] = [];

  layers.forEach((layer, li) => {
    const tint = composeTint(layer.tint, biomeTint);
    const points = scatterClusters(0xC0E + biome.charCodeAt(0) * 13 + li * 97, {
      clusters: layer.clusters,
      perCluster: layer.perCluster,
      radius: layer.radius,
      spacing: layer.spacing,
      test: (x, z) => coverFits(x, z) && placeAt(x, z) === biome,
      bounds,
    });
    for (const p of points) {
      out.push({
        key: layer.species[Math.floor(p.t * layer.species.length) % layer.species.length],
        x: p.x,
        z: p.z,
        y: heightAt(p.x, p.z) - 0.05,
        r: p.r,
        tilt: (p.t - 0.5) * 0.12,
        height: lerp(layer.height[1], layer.height[0], p.d),
        tintKey: tint ? `${biome}-cover-${li}` : undefined,
        tint,
      });
    }
  });
  return out;
}

function betweenSeeds(): Seed[] {
  const out: Seed[] = [];
  BETWEEN_COVER.forEach((layer, li) => {
    const tint = composeTint(layer.tint, undefined);
    const points = scatterClusters(0xB7E + li * 131, {
      clusters: layer.clusters,
      perCluster: layer.perCluster,
      radius: layer.radius,
      spacing: layer.spacing,
      test: (x, z) => coverFits(x, z) && placeAt(x, z) === null && Math.hypot(x, z * 0.95) < 150,
      bounds: { x0: -155, x1: 155, z0: -160, z1: 160 },
    });
    for (const p of points) {
      out.push({
        key: layer.species[Math.floor(p.t * layer.species.length) % layer.species.length],
        x: p.x, z: p.z, y: heightAt(p.x, p.z) - 0.05, r: p.r, tilt: (p.t - 0.5) * 0.12,
        height: lerp(layer.height[1], layer.height[0], p.d),
        tintKey: tint ? `between-cover-${li}` : undefined,
        tint,
      });
    }
  });
  return out;
}

/** Hierba alta y densa dentro de las manchas de spawn, más alta que la del prado que las rodea. */
function patchSeeds(): Seed[] {
  const out: Seed[] = [];
  PATCHES.forEach((patch, i) => {
    const tint = composeTint(GRASS_LIFT, COVER_TINTS[patch.zone]);
    const points = scatterClusters(0x7A7C + i * 313, {
      clusters: 3,
      perCluster: PATCH_GRASS.perCluster,
      radius: [Math.min(patch.rx, patch.rz) * 0.7, Math.max(patch.rx, patch.rz) * 0.95],
      spacing: PATCH_GRASS.spacing,
      test: (x, z) => coverFits(x, z) && inPatch(x, z) !== null,
      bounds: { x0: patch.x - patch.rx, x1: patch.x + patch.rx, z0: patch.z - patch.rz, z1: patch.z + patch.rz },
      falloff: 1.2,
    });
    for (const p of points) {
      // Solo la variante grande de hierba: la mata pequeña no levanta silueta y la mancha tiene que
      // leerse de lejos como hierba alta.
      const useFlower = p.t > 0.86 && (patch.zone === 'meadow' || patch.zone === 'ruins');
      out.push({
        key: useFlower
          ? SPECIES.flower[Math.floor(p.t * 1000) % SPECIES.flower.length]
          : SPECIES.grass[0],
        x: p.x,
        z: p.z,
        y: heightAt(p.x, p.z) - 0.06,
        r: p.r,
        tilt: (p.t - 0.5) * 0.14,
        height: useFlower ? lerp(0.4, 0.7, p.t) : lerp(PATCH_GRASS.height[0], PATCH_GRASS.height[1], p.d),
        // Las flores no llevan el aclarado de la hierba: su textura ya es de tono correcto.
        tintKey: useFlower ? undefined : `patch-${patch.zone}`,
        tint: useFlower ? undefined : tint,
      });
    }
  });
  return out;
}

let cached: Seed[] | null = null;

/** Siembra determinista de toda la cubierta. La fauna (mariposas) la lee para saber dónde hay flores. */
export function coverSeeds(): Seed[] {
  if (cached) return cached;
  const all: Seed[] = [];
  for (const biome of Object.keys(BIOME_COVER)) all.push(...biomeSeeds(biome));
  all.push(...betweenSeeds());
  all.push(...patchSeeds());
  cached = all;
  return all;
}

export const GroundCover: React.FC = () => {
  const seeds = useMemo(coverSeeds, []);

  // Sin contorno y sin sombra: son miles de instancias y a este tamaño ninguna de las dos se aprecia,
  // pero las dos cuestan.
  const instances = useStylizedInstances(seeds, { outline: 0, castShadow: false, scaleClamp: [0.45, 2.6], wind: 'cover' });

  return <group>{instances.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
