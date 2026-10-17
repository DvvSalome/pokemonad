import React, { useMemo } from 'react';
import { clearOf, heightAt, placeAt, around, dist, PLACES, WATER_Y, SPAWN, SPAWN_CLEARING } from './terrain';
import { scatterClusters, scatterSingles } from './scatter';
import { BIOME_TREES, LANDMARK_TREES, TINTS } from './stylized';
import { useStylizedInstances, type Seed } from './useStylized';

// Los árboles se siembran en bosquecillos, no repartidos parejo. Dentro de cada grupo la altura va del
// máximo en el núcleo al mínimo en el borde, así que el grupo tiene copa y se deshilacha hacia fuera en
// vez de ser una mancha de ejemplares iguales. Encima van unos pocos árboles sueltos más altos que
// marcan el horizonte.
//
// Las alturas, especies y paletas están en stylized.ts — este archivo solo las siembra.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function seedsFor(biome: string): Seed[] {
  const place = PLACES[biome];
  const bounds = around(biome, place.r * 1.08);
  const tints = TINTS[biome];
  const out: Seed[] = [];

  const fits = (pad: number) => (x: number, z: number) => {
    if (!clearOf(x, z, pad)) return false;
    if (heightAt(x, z) < WATER_Y + 0.35) return false;
    if (dist(x, z, SPAWN) < SPAWN_CLEARING) return false;
    return placeAt(x, z) === biome;
  };

  const layers = BIOME_TREES[biome] ?? [];
  layers.forEach((layer, li) => {
    const points = scatterClusters(0xF00 + biome.charCodeAt(0) * 7 + li * 131, {
      clusters: layer.clusters,
      perCluster: layer.perCluster,
      radius: layer.radius,
      spacing: layer.spacing,
      test: fits(layer.spacing * 0.6),
      bounds,
    });
    for (const p of points) {
      const tint = tints ? tints[Math.floor(p.t * tints.length) % tints.length] : undefined;
      out.push({
        key: layer.species[Math.floor(p.t * layer.species.length) % layer.species.length],
        x: p.x,
        z: p.z,
        // Hundir un poco la base evita que la inclinación deje el tronco flotando sobre la pendiente.
        y: heightAt(p.x, p.z) - 0.12,
        r: p.r,
        tilt: layer.tilt ? (p.t - 0.5) * 2 * layer.tilt : 0,
        height: lerp(layer.height[1], layer.height[0], p.d),
        tintKey: tint ? `${biome}-${Math.floor(p.t * (tints?.length ?? 1))}` : undefined,
        tint,
      });
    }
  });

  (LANDMARK_TREES[biome] ?? []).forEach((landmark, ai) => {
    const points = scatterSingles(0xA11 + biome.charCodeAt(0) * 17 + ai * 401, {
      count: landmark.count,
      spacing: 14,
      test: fits(5),
      bounds,
    });
    for (const p of points) {
      const tint = tints ? tints[Math.floor(p.t * tints.length) % tints.length] : undefined;
      out.push({
        key: landmark.species[Math.floor(p.t * landmark.species.length) % landmark.species.length],
        x: p.x,
        z: p.z,
        y: heightAt(p.x, p.z) - 0.12,
        r: p.r,
        height: lerp(landmark.height[0], landmark.height[1], p.t),
        tintKey: tint ? `${biome}-${Math.floor(p.t * (tints?.length ?? 1))}` : undefined,
        tint,
      });
    }
  });

  return out;
}

export const Trees: React.FC = () => {
  const seeds = useMemo(() => {
    const all: Seed[] = [];
    for (const biome of Object.keys(BIOME_TREES)) all.push(...seedsFor(biome));
    return all;
  }, []);

  // Contorno solo en la vegetación grande: es donde la silueta hace el trabajo. Ponerlo también en
  // hierba y flores duplicaría miles de instancias para un contorno que a ese tamaño no se ve.
  const instances = useStylizedInstances(seeds, { outline: 0.014, castShadow: true, scaleClamp: [0.8, 2.4], wind: 'tree' });

  return <group>{instances.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
