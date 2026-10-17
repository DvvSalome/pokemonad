import React, { useMemo } from 'react';
import { clearOf, heightAt, placeAt, around, PLACES, WATER_Y } from './terrain';
import { scatterClusters } from './scatter';
import { SPECIES, BIOME_ROCKS, ROCK_TINTS } from './stylized';
import { useStylizedInstances, type Seed } from './useStylized';

// Las rocas también van en grupos: los afloramientos reales aparecen juntos, y agrupadas dan una roca
// grande con sus lajas alrededor en vez de piedras sueltas repartidas por igual. Hundirlas bastante en
// el terreno es lo que las hace leer como afloramiento y no como canto apoyado encima.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function seedsFor(biome: string): Seed[] {
  const cfg = BIOME_ROCKS[biome];
  if (!cfg) return [];
  const place = PLACES[biome];
  const tint = ROCK_TINTS[biome];

  const points = scatterClusters(0xA0C + biome.charCodeAt(0) * 29, {
    clusters: cfg.clusters,
    perCluster: cfg.perCluster,
    radius: cfg.radius,
    spacing: 1.6,
    test: (x, z) => {
      if (!clearOf(x, z, 1.2)) return false;
      if (heightAt(x, z) < WATER_Y + 0.2) return false;
      return placeAt(x, z) === biome;
    },
    bounds: around(biome, place.r * 1.08),
  });

  return points.map((p) => {
    const height = lerp(cfg.height[1], cfg.height[0], p.d);
    return {
      key: SPECIES.rock[Math.floor(p.t * SPECIES.rock.length) % SPECIES.rock.length],
      x: p.x,
      z: p.z,
      // Un cuarto de su altura enterrado: apoyada exacta en el suelo se ve puesta encima.
      y: heightAt(p.x, p.z) - height * 0.26,
      r: p.r,
      tilt: (p.t - 0.5) * 0.18,
      height,
      tintKey: tint ? biome : undefined,
      tint,
    };
  });
}

export const Rocks: React.FC = () => {
  const seeds = useMemo(() => {
    const all: Seed[] = [];
    for (const biome of Object.keys(BIOME_ROCKS)) all.push(...seedsFor(biome));
    return all;
  }, []);

  const instances = useStylizedInstances(seeds, { outline: 0.014, castShadow: true, receiveShadow: true, scaleClamp: [0.3, 2.2] });

  return <group>{instances.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
