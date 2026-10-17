import React, { useMemo } from 'react';
import { scatterIn, clearOf, heightAt, placeAt, dist, WATER_Y, CAMP, SPAWN, SPAWN_CLEARING } from './terrain';
import { useStylizedInstances, type Seed } from './useStylized';

// Fauna ambiental: poses fijas repartidas por la región, sin IA, solo para que el sitio se sienta
// habitado. Cube World Kit (CC0).
//
// Este pack es blocky y el resto del mundo es estilizado suave, así que se cura en dos sentidos:
//   - Solo bichos pequeños. Antes había un caballo, y a tamaño de caballo la geometría en bloques se
//     ve desde lejos y rompe la armonía; a tamaño de gallina lee como un detalle simpático.
//   - Alturas reales en metros en vez de la escala nativa del GLB, así una gallina mide de gallina.
//     Escalarlos "0.75–1.15× lo que venga" hacía que el mismo animal saliera de tamaños incoherentes.
// Con el contorno y el material toon que ya aplica el cargador, se integran con el resto.

interface Critter { url: string; height: number }

const CRITTERS: Record<string, Critter> = {
  sheep: { url: '/critters/sheep.glb', height: 1.05 },
  pig: { url: '/critters/pig.glb', height: 0.85 },
  chicken: { url: '/critters/chicken.glb', height: 0.5 },
  chick: { url: '/critters/chick.glb', height: 0.26 },
  raccoon: { url: '/critters/raccoon.glb', height: 0.48 },
  hedgehog: { url: '/critters/hedgehog.glb', height: 0.28 },
  dog: { url: '/critters/dog.glb', height: 0.65 },
  cat: { url: '/critters/cat.glb', height: 0.42 },
};

const ZONE_CRITTERS: Record<string, { names: string[]; count: number }> = {
  meadow: { names: ['sheep', 'pig', 'chicken', 'chick'], count: 14 },
  woods: { names: ['raccoon', 'hedgehog'], count: 14 },
};

function scatterZone(zone: string): Seed[] {
  const { names, count } = ZONE_CRITTERS[zone];
  const scattered = scatterIn(0x9A0 + zone.charCodeAt(0), count, (x, z) => {
    if (!clearOf(x, z, 1.0)) return false;
    if (heightAt(x, z) < WATER_Y + 0.2) return false;
    // Igual que con los árboles: un animal justo en el spawn se lleva la primera mirada del jugador.
    if (dist(x, z, SPAWN) < SPAWN_CLEARING * 0.55) return false;
    return placeAt(x, z) === zone;
  }, (r) => 0.9 + r() * 0.25);

  return scattered.map((s, i) => {
    const critter = CRITTERS[names[i % names.length]];
    return {
      key: critter.url,
      x: s.x,
      z: s.z,
      y: heightAt(s.x, s.z),
      r: s.r,
      // s del scatter se usa como variación de talla sobre la altura nominal, no como escala absoluta.
      height: critter.height * s.s,
    };
  });
}

function campPets(): Seed[] {
  const spots: [string, number, number, number][] = [
    ['dog', CAMP.x + 1, CAMP.z + 3, 2.1],
    ['cat', CAMP.x - 2.5, CAMP.z + 0.5, 0.3],
  ];
  return spots.map(([name, x, z, r]) => ({
    key: CRITTERS[name].url,
    x,
    z,
    y: heightAt(x, z),
    r,
    height: CRITTERS[name].height,
  }));
}

export const Wildlife: React.FC = () => {
  const seeds = useMemo(() => {
    const all: Seed[] = [];
    for (const zone of Object.keys(ZONE_CRITTERS)) all.push(...scatterZone(zone));
    all.push(...campPets());
    return all;
  }, []);

  const instances = useStylizedInstances(seeds, {
    outline: 0.014,
    castShadow: true,
    receiveShadow: true,
    scaleClamp: [0.05, 4],
  });

  return <group>{instances.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
