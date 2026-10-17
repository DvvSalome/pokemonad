import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { scatterIn, clearOf, heightAt, placeAt } from './terrain';
import { loadModelSet, type ModelPart } from './modelLoader';

// A hand-designed garden vignette using "Pretty Park Set" (CC0, Isa Lousberg) — this pack is one
// cohesive set (bench + lantern + trashcan + hedges + fountain all share one style), so it gets its
// own manicured corner of the meadow instead of being scattered randomly like the wild biome props.
interface Placed { url: string; x: number; y: number; z: number; r: number; s: number }

function findParkSpot(): { x: number; z: number } {
  // Auto-locate a clear spot in the meadow's southeast quadrant, away from the pond/camp/arena/
  // patches/paths — reuses the same clearOf test the terrain itself uses for walkability, so this
  // can never land the park on top of something else.
  const spots = scatterIn(0x9A2C, 1, (x, z) => clearOf(x, z, 9) && placeAt(x, z) === 'meadow', undefined, {
    x0: 12, x1: 30, z0: -30, z1: -8,
  });
  return spots[0] ?? { x: 20, z: -20 };
}

function buildLayout(cx: number, cz: number): Placed[] {
  const y = (x: number, z: number) => heightAt(x, z);
  const faceCenter = (x: number, z: number) => Math.atan2(cx - x, cz - z);

  const items: Placed[] = [
    // Ground
    { url: '/park/cobble-stones-large.glb', x: cx, z: cz, r: 0, s: 1.4 },
    { url: '/park/cobble-stones.glb', x: cx + 3.5, z: cz + 1.5, r: 0.4, s: 1.1 },
    { url: '/park/cobble-stones.glb', x: cx - 3.2, z: cz - 1.8, r: 1.1, s: 1.1 },

    // Centerpiece
    { url: '/park/fountain.glb', x: cx, z: cz, r: 0, s: 1.5 },

    // Benches facing the fountain
    { url: '/park/bench.glb', x: cx + 3.4, z: cz, r: faceCenter(cx + 3.4, cz), s: 1.2 },
    { url: '/park/bench.glb', x: cx - 3.4, z: cz, r: faceCenter(cx - 3.4, cz), s: 1.2 },
    { url: '/park/bench.glb', x: cx, z: cz + 3.4, r: faceCenter(cx, cz + 3.4), s: 1.2 },
    { url: '/park/bench.glb', x: cx, z: cz - 3.4, r: faceCenter(cx, cz - 3.4), s: 1.2 },

    // Lanterns at the diagonal corners
    { url: '/park/street-lantern.glb', x: cx + 4.2, z: cz + 4.2, r: 0, s: 1.3 },
    { url: '/park/street-lantern.glb', x: cx - 4.2, z: cz + 4.2, r: 0, s: 1.3 },
    { url: '/park/street-lantern.glb', x: cx + 4.2, z: cz - 4.2, r: 0, s: 1.3 },
    { url: '/park/street-lantern.glb', x: cx - 4.2, z: cz - 4.2, r: 0, s: 1.3 },

    // Hedge boundary — long segments on each side, corners rounding it off
    { url: '/park/hedge-straight-long.glb', x: cx, z: cz + 6.5, r: 0, s: 1.2 },
    { url: '/park/hedge-straight-long.glb', x: cx, z: cz - 6.5, r: Math.PI, s: 1.2 },
    { url: '/park/hedge-straight-long.glb', x: cx + 6.5, z: cz, r: Math.PI / 2, s: 1.2 },
    { url: '/park/hedge-straight-long.glb', x: cx - 6.5, z: cz, r: -Math.PI / 2, s: 1.2 },
    { url: '/park/hedge-corner.glb', x: cx + 6.2, z: cz + 6.2, r: 0, s: 1.2 },
    { url: '/park/hedge-corner.glb', x: cx - 6.2, z: cz + 6.2, r: Math.PI / 2, s: 1.2 },
    { url: '/park/hedge-corner.glb', x: cx + 6.2, z: cz - 6.2, r: -Math.PI / 2, s: 1.2 },
    { url: '/park/hedge-corner.glb', x: cx - 6.2, z: cz - 6.2, r: Math.PI, s: 1.2 },

    // Shade tree, bushes, trashcan, and a bird to give it life
    { url: '/park/tree-large.glb', x: cx - 5.3, z: cz + 5.3, r: 0.6, s: 1.6 },
    { url: '/park/bush-large.glb', x: cx + 5.3, z: cz - 5.3, r: 0.2, s: 1.3 },
    { url: '/park/bush.glb', x: cx + 5.0, z: cz + 2.0, r: 0.9, s: 1.1 },
    { url: '/park/trashcan.glb', x: cx + 2.4, z: cz + 3.9, r: 0.3, s: 1.0 },
    { url: '/park/bird.glb', x: cx + 3.4, z: cz + 0.6, r: 0.5, s: 1.0 },
  ].map((item) => ({ ...item, y: y(item.x, item.z) }));

  // A scatter of flowers inside the hedge ring for ground color.
  const flowerSpots = scatterIn(0x9A2D, 14, (x, z) => Math.hypot(x - cx, z - cz) < 5.8 && Math.hypot(x - cx, z - cz) > 2.2,
    (r) => 0.8 + r() * 0.4, { x0: cx - 6, x1: cx + 6, z0: cz - 6, z1: cz + 6 });
  const flowers: Placed[] = flowerSpots.map((s, i) => ({
    url: i % 2 === 0 ? '/park/flower-a.glb' : '/park/flower-b.glb',
    x: s.x, z: s.z, r: s.r, s: s.s, y: y(s.x, s.z),
  }));

  return [...items, ...flowers];
}

export const Park: React.FC = () => {
  const placements = useMemo(() => {
    const { x, z } = findParkSpot();
    return buildLayout(x, z);
  }, []);

  const urls = useMemo(() => Array.from(new Set(placements.map((p) => p.url))), [placements]);
  const [modelMap, setModelMap] = useState<Map<string, ModelPart[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadModelSet(urls).then((m) => { if (!cancelled) setModelMap(m); });
    return () => { cancelled = true; };
  }, [urls]);

  const instances = useMemo(() => {
    if (!modelMap) return [];
    const byUrl = new Map<string, Placed[]>();
    for (const p of placements) {
      const arr = byUrl.get(p.url);
      if (arr) arr.push(p); else byUrl.set(p.url, [p]);
    }

    const meshes: THREE.InstancedMesh[] = [];
    const dummy = new THREE.Object3D();

    for (const [url, group] of byUrl) {
      const parts = modelMap.get(url);
      if (!parts) continue;
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, group.length);
        im.castShadow = true;
        im.receiveShadow = true;
        for (let i = 0; i < group.length; i++) {
          const p = group[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(0, p.r, 0);
          dummy.scale.setScalar(p.s);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        meshes.push(im);
      }
    }
    return meshes;
  }, [modelMap, placements]);

  return <group>{instances.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
