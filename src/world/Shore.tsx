// La playa que rodea la isla: palmeras inclinadas, cantos rodados, madera varada y algún barril perdido.
//
// La franja de arena mide unos cuarenta metros y da la vuelta entera a la región, así que vacía se leía
// como un desierto de relleno. Esto la puebla con muy poca cosa pero bien repartida: grupos de palmeras
// mirando al mar, piedras en la línea de la marea y restos de naufragio, que es lo que ata la costa con
// los embarcaderos y los barcos de los conjuntos construidos (ver Landmarks.tsx).
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { scatterIn, heightAt, coliseumDist, builtDist, WATER_Y, COAST_FROM, SHORE, COLISEUM } from './terrain';
import { SPECIES } from './stylized';
import { useStylizedInstances, type Seed } from './useStylized';

const P = (f: string) => `/pirate/${f}.glb`;

/** Restos de naufragio: lo que la marea deja en la arena. */
const DRIFT = [P('wood'), P('barrel'), P('post'), P('rock-3'), P('rocks-2')];
/** Tinte de la vegetación de costa: el sol de la playa lava el verde y calienta el tronco. */
const SHORE_TINT = { leaves: new THREE.Color().setRGB(1.15, 1.05, 0.7), bark: new THREE.Color(0xc9ab82) };
const STONE_TINT = { all: new THREE.Color(0xe3d6b4) };

/** La franja: arena firme, fuera del agua y lejos de lo ya construido. */
function onBeach(x: number, z: number): boolean {
  const R = Math.hypot(x, z * 0.95);
  if (R < COAST_FROM + 18 || R > SHORE - 4) return false;
  const h = heightAt(x, z);
  if (h < WATER_Y + 0.35 || h > 1.6) return false;
  if (coliseumDist(x, z) < COLISEUM.clear || builtDist(x, z) < 6) return false;
  return true;
}

export const Shore: React.FC = () => {
  const seeds = useMemo(() => {
    const out: Seed[] = [];
    const bounds = { x0: -SHORE, x1: SHORE, z0: -SHORE, z1: SHORE };

    // Palmeras en grupitos: se siembra el grupo y las demás caen alrededor.
    // El anillo de playa mide más de un kilómetro de largo: con pocas decenas de grupos, la arena se
    // veía vacía. Estas cifras dan una palmera cada quince metros de costa, que es lo que la puebla sin
    // convertirla en un palmeral.
    for (const g of scatterIn(0x5EA1, 90, onBeach, undefined, bounds)) {
      const n = 2 + Math.floor(g.s * 3) % 3;
      for (let i = 0; i < n; i++) {
        const a = g.r + i * 2.1, d = 2.5 + i * 2.2;
        const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
        if (!onBeach(x, z)) continue;
        out.push({
          key: SPECIES.palm[(i + Math.floor(g.r * 3)) % SPECIES.palm.length],
          x, z, y: heightAt(x, z) - 0.1, r: a,
          height: 6.5 + ((i * 37 + g.r * 11) % 1) * 4,
          tilt: 0.08 + ((i * 13 + g.r * 7) % 1) * 0.12,
          tintKey: 'shore-palm', tint: SHORE_TINT,
        });
      }
    }

    // Piedras y cantos en la línea de la marea.
    for (const s of scatterIn(0x5EA2, 420, onBeach, (r) => 0.4 + r() * 1.6, bounds)) {
      const pool = s.s > 1.2 ? SPECIES.rock : SPECIES.pebble;
      out.push({
        key: pool[Math.floor(s.r * pool.length) % pool.length],
        x: s.x, z: s.z, y: heightAt(s.x, s.z) - s.s * 0.2, r: s.r,
        height: s.s, tilt: (s.r % 1 - 0.5) * 0.3,
        tintKey: 'shore-stone', tint: STONE_TINT,
      });
    }

    // Restos varados, muy sueltos: uno cada mucho trecho.
    for (const s of scatterIn(0x5EA3, 110, onBeach, (r) => 0.9 + r() * 0.9, bounds)) {
      out.push({
        key: DRIFT[Math.floor(s.r * DRIFT.length) % DRIFT.length],
        x: s.x, z: s.z, y: heightAt(s.x, s.z), r: s.r,
        height: s.s, tilt: (s.r % 1 - 0.5) * 0.9,
      });
    }
    return out;
  }, []);

  const instances = useStylizedInstances(seeds, { outline: 0.014, castShadow: true, receiveShadow: true, scaleClamp: [0.3, 3] });

  return <group>{instances.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
