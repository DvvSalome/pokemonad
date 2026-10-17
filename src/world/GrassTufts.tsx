import React, { useMemo } from 'react';
import * as THREE from 'three';
import { scatterIn, heightAt, placeAt, pathDist, inLava, naturalGroundColor, WATER_Y, coliseumDist, COLISEUM } from './terrain';
import { n2, n3, smooth } from './noise';
import { toonRampSoft } from './toon';
import { PEDESTAL } from './TitleCamera';
import { WIND, WIND_GLSL } from './life/wind';

// Capa base de briznas procedurales, con viento. Se queda junto a la hierba del pack (GroundCover.tsx)
// porque aporta dos cosas que las mallas estáticas no: movimiento, y una alfombra fina y barata que
// tapa el suelo desnudo entre los grupos. Bajó de 11.000 a 6.500 matas justo porque ahora el volumen
// lo pone el pack y estas solo tienen que rellenar.
//
// El color ahora sale del bioma: antes toda la región usaba la misma paleta de verdes, así que el
// cráter del volcán y el pico nevado tenían hierba de pradera.
//
// Cada brizna nace del color exacto del suelo bajo la mata (naturalGroundColor) y aclara hacia la punta:
// con un color plano por mata, la base cortaba contra el terreno y las matas se leían pegadas encima.

// Toda la región caminable, no solo dentro de los biomas: entre zona y zona el suelo quedaba desnudo.
// Con 24.000 el suelo no respiraba en ningún sitio y el conjunto se leía saturado: la mitad basta para
// que el terreno no se vea pelado, y deja claros donde el color del suelo sí se lee.
const GRASS_COUNT = 11000;
const BLADES_PER_TUFT = 5;
const BLADE_H = 0.62;
const BLADE_W = 0.11;

const C = (hex: number) => new THREE.Color(hex);

// Verdes apagados, en la familia terrosa del coliseo: los anteriores (0x6fce6a, 0x8fcf52…) sin tone
// mapping llegaban a pantalla casi neón.
const PALETTES: Record<string, THREE.Color[]> = {
  meadow: [C(0x4f8a40), C(0x5b9546), C(0x679f4c), C(0x74a852), C(0x86ad5a)],
  lake: [C(0x5b9a55), C(0x6aa65c), C(0x7cb164), C(0x8fb86a)],
  woods: [C(0x3f7437), C(0x4a7f3d), C(0x558a44), C(0x62944b)],
  ruins: [C(0x9aa55a), C(0xaaae64), C(0xb8b56f), C(0x8c9a52)],
  volcano: [C(0x6b5a4a), C(0x7d6a55), C(0x8a7460), C(0x5c4d40)],
  peak: [C(0xcfe2ee), C(0xdcebf4), C(0xbed6e6)],
  summit: [C(0xbfd68f), C(0xa8c47a)],
  forest: [C(0x467f3b), C(0x508942), C(0x5c9348), C(0x699c4e)],
};
const DRY_TIP = C(0xc2b877);

/** Briznas de dos tramos que se estrechan y se curvan: la curva sale de empujar más la punta que el medio. */
function makeTuftGeo(): THREE.BufferGeometry {
  const verts: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  for (let b = 0; b < BLADES_PER_TUFT; b++) {
    const angle = (b / BLADES_PER_TUFT) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
    const spread = 0.05 + Math.random() * 0.1;
    const ox = Math.cos(angle) * spread;
    const oz = Math.sin(angle) * spread;
    const h = BLADE_H * (0.6 + Math.random() * 0.75);
    const lean = 0.12 + Math.random() * 0.14;
    const lx = Math.cos(angle) * lean;
    const lz = Math.sin(angle) * lean;
    // La brizna se orienta de canto respecto a su dirección de caída, como una hoja de verdad.
    const px = -Math.sin(angle) * BLADE_W * 0.5;
    const pz = Math.cos(angle) * BLADE_W * 0.5;
    const i0 = verts.length / 3;
    verts.push(
      ox - px, 0, oz - pz,
      ox + px, 0, oz + pz,
      ox + lx * 0.3 - px * 0.6, h * 0.55, oz + lz * 0.3 - pz * 0.6,
      ox + lx * 0.3 + px * 0.6, h * 0.55, oz + lz * 0.3 + pz * 0.6,
      ox + lx, h, oz + lz,
    );
    along.push(0, 0, 0.55, 0.55, 1);
    index.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2, i0 + 2, i0 + 3, i0 + 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(along.flatMap(() => [0, 1, 0]), 3));
  geo.setIndex(index);
  return geo;
}

/**
 * Material toon del mundo (misma rampa suave que los props) con dos añadidos: viento en espacio de mundo y
 * el degradado raíz→punta. Antes era un ShaderMaterial sin luces: no recibía sombra, así que bajo los
 * árboles las briznas seguían a pleno sol y se leían pálidas y pegadas encima del suelo sombreado.
 * La normal se fuerza hacia arriba para que la brizna se ilumine igual que el suelo del que nace.
 */
function grassMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ gradientMap: toonRampSoft(), side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLifeT = WIND.uLifeT;
    shader.uniforms.uWindDir = WIND.uWindDir;
    shader.uniforms.uPlayer = WIND.uPlayer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${WIND_GLSL}
        attribute float aAlong;
        attribute vec3 aBase;
        varying float vAlong;
        varying float vGust;
        varying vec3 vBase;`)
      .replace('#include <project_vertex>', `
        vAlong = aAlong;
        vBase = aBase;
        vec4 world = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vec3 root = (modelMatrix * instanceMatrix[3]).xyz;
        float seed = fract(sin(root.x * 12.9898 + root.z * 78.233) * 43758.5453);
        // La amplitud crece con el cuadrado de la altura: la raíz no se mueve.
        float hw = aAlong * aAlong;
        world.xyz += lifeWind(world.xyz, root, hw, 0.2, seed);
        world.xyz += lifePush(world.xyz, root, hw, 0.42);
        vGust = lifeGust(root.xz) * aAlong;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;\nvarying float vGust;\nvarying vec3 vBase;')
      // La ráfaga aclara un poco las puntas al tumbarlas (se ve el envés, más pálido): es lo que hace
      // que el frente de viento se lea rodando por el prado. Aclarado mate hacia paja, no brillo.
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(vBase, vColor, smoothstep(0.0, 0.5, vAlong));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.1 + vec3(0.05, 0.05, 0.02), vGust * 0.8);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
  };
  m.customProgramCacheKey = () => 'grass-toon-wind';
  return m;
}

export const GrassTufts: React.FC = () => {
  const mesh = useMemo(() => {
    const g = makeTuftGeo();
    const scattered = scatterIn(0x6A55, GRASS_COUNT, (x, z) => {
      const h = heightAt(x, z);
      if (h < WATER_Y + 0.15 || Math.hypot(x, z * 0.95) > 152) return false;
      if (Math.hypot(x - PEDESTAL.x, z - PEDESTAL.z) < 2) return false;
      if (coliseumDist(x, z) < COLISEUM.wall + 1.6) return false;
      return pathDist(x, z) > 1.9 && !inLava(x, z, 0.6);
    }, (r) => 0.7 + r() * 0.9);

    const dummy = new THREE.Object3D();
    const im = new THREE.InstancedMesh(g, grassMaterial(), scattered.length);
    im.receiveShadow = true;

    const tipArray = new Float32Array(scattered.length * 3);
    const baseArray = new Float32Array(scattered.length * 3);
    const base = new THREE.Color();
    const tip = new THREE.Color();
    for (let i = 0; i < scattered.length; i++) {
      const s = scattered[i];
      const y = heightAt(s.x, s.z);
      dummy.position.set(s.x, y - 0.03, s.z);
      dummy.rotation.set(0, s.r, 0);
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);

      // Raíz un poco más oscura que el suelo: se lee como la sombra de la propia mata.
      naturalGroundColor(s.x, s.z, y, base).multiplyScalar(0.8);
      const palette = PALETTES[placeAt(s.x, s.z) ?? 'forest'] ?? PALETTES.forest;
      // El tono sigue manchas de ruido en vez de sortearse por mata: la hierba real crece en rodales.
      const k = Math.min(palette.length - 1, Math.floor(n2(s.x * 0.09, s.z * 0.09) * palette.length * 1.15));
      tip.copy(palette[Math.max(0, k)]).lerp(DRY_TIP, smooth(0.55, 0.8, n3(s.x * 0.045 + 11, s.z * 0.045 - 7)) * 0.3);
      // Más oscura que el suelo que la rodea: la brizna se distingue por silueta, no por brillo.
      tip.multiplyScalar(0.64 + Math.random() * 0.12);
      tipArray.set([tip.r, tip.g, tip.b], i * 3);
      baseArray.set([base.r, base.g, base.b], i * 3);
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor = new THREE.InstancedBufferAttribute(tipArray, 3);
    g.setAttribute('aBase', new THREE.InstancedBufferAttribute(baseArray, 3));
    im.frustumCulled = false;
    return im;
  }, []);

  return <primitive object={mesh} />;
};
