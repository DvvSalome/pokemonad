import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { LIFE, LIFE_UNIFORMS, lifeMaterial } from './lifeState';
import { WIND } from './wind';

// Motas en el aire alrededor del jugador: polen y alguna hoja suelta de día, luciérnagas de noche.
//
// Cada partícula vive en una caja que viaja con el jugador y se envuelve con mod(): la que sale por un
// lado entra por el otro, así un puñado basta para llenar lo que ve la cámara. Los bordes de la caja se
// funden con la distancia para que el salto del envoltorio no se vea. Todo el movimiento es del
// shader; la CPU solo pasa la posición del jugador.

interface MoteSet {
  count: number;
  box: [number, number, number];
  kind: 'pollen' | 'leaf' | 'firefly';
}

const SETS: MoteSet[] = [
  { count: 70, box: [26, 6, 26], kind: 'pollen' },
  { count: 16, box: [30, 8, 30], kind: 'leaf' },
  { count: 120, box: [36, 2.6, 36], kind: 'firefly' },
];

const vert = /* glsl */ `
uniform float uLifeT;
uniform vec2 uWindDir;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uKind; // 0 polen, 1 hoja, 2 luciérnaga
attribute vec4 aSeed;
attribute vec3 aTint;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
varying float vGlow;
void main() {
  vUv = uv;
  vTint = aTint;
  float t = uLifeT;
  float ph = aSeed.w * 6.2831;
  vec3 p = aSeed.xyz * uBox;
  float size;
  float rot = 0.0;
  float squash = 1.0;
  vGlow = 0.0;
  if (uKind < 0.5) {
    p.xz += uWindDir * t * (0.5 + aSeed.w * 0.5);
    p += vec3(sin(t * 0.7 + ph), sin(t * 0.9 + ph * 1.7) * 0.6, cos(t * 0.6 + ph)) * 0.45;
    size = 0.045 + aSeed.w * 0.03;
  } else if (uKind < 1.5) {
    // Las hojas planean: bajan despacio, avanzan con el viento y cabecean.
    p.xz += uWindDir * t * (1.1 + aSeed.w * 0.6);
    p.y -= t * 0.35;
    p.x += sin(t * 1.3 + ph) * 0.7;
    rot = t * (1.5 + aSeed.w * 2.0) + ph;
    squash = 0.35 + 0.65 * abs(cos(t * 2.1 + ph));
    size = 0.13 + aSeed.w * 0.06;
  } else {
    p += vec3(sin(t * 0.31 + ph) * 1.8, sin(t * 0.53 + ph * 2.3) * 0.5, cos(t * 0.27 + ph * 1.3) * 1.8);
    // Parpadeo lento: cada una se enciende un rato y se apaga, desfasadas.
    vGlow = pow(max(0.0, sin(t * (0.9 + aSeed.w * 0.7) + ph * 3.0)), 3.0);
    size = 0.16 + 0.34 * vGlow;
  }
  vec3 lo = uCenter - uBox * vec3(0.5, 0.0, 0.5);
  p = lo + mod(p - lo, uBox);
  p.y += uKind > 1.5 ? 0.35 : 0.25;
  vec2 dc = (p.xz - uCenter.xz) / (uBox.xz * 0.5);
  float edge = 1.0 - smoothstep(0.6, 1.0, length(dc));
  float vfade = smoothstep(0.0, 0.08, (p.y - uCenter.y) / uBox.y);
  vAlpha = edge * vfade;
  if (uKind > 1.5) vAlpha *= uNight;
  else vAlpha *= 1.0 - uNight * 0.85;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  float c = cos(rot), s = sin(rot);
  vec2 q = position.xy * vec2(squash, 1.0);
  mvPosition.xy += mat2(c, s, -s, c) * q * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform float uKind;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
varying float vGlow;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d);
  vec4 col;
  if (uKind < 0.5) {
    col = vec4(vTint * uLight, smoothstep(0.5, 0.2, r) * 0.85);
  } else if (uKind < 1.5) {
    // Silueta de hoja: rombo redondeado con la punta arriba.
    float leaf = abs(d.x) * 2.2 + abs(d.y) * 1.4 + d.y * d.y * 1.5;
    if (leaf > 0.95) discard;
    col = vec4(vTint * uLight * (0.9 + 0.1 * step(abs(d.x), 0.03)), 1.0);
  } else {
    // Luciérnaga: núcleo cálido con halo suave. Aditiva, así que no necesita bloom para leerse.
    float core = smoothstep(0.14, 0.0, r);
    float halo = smoothstep(0.5, 0.0, r);
    col = vec4(vTint * (core * 1.5 + halo * halo * 0.7) * (0.3 + vGlow), 1.0);
  }
  col.a *= vAlpha;
  if (col.a < 0.01) discard;
  gl_FragColor = col;
  #include <fog_fragment>
}`;

const TINTS: Record<MoteSet['kind'], number[]> = {
  pollen: [0xfff1c8, 0xf4f0dc, 0xffe7a8],
  leaf: [0x7ea24e, 0xa3a84e, 0xc59a4a, 0x6f9a48],
  firefly: [0xd6f27a, 0xe8e27a, 0xbfee86],
};

function buildSet(set: MoteSet, center: THREE.IUniform<THREE.Vector3>): THREE.Mesh {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  g.instanceCount = set.count;
  const seeds = new Float32Array(set.count * 4);
  const tints = new Float32Array(set.count * 3);
  const palette = TINTS[set.kind].map((h) => new THREE.Color(h));
  for (let i = 0; i < set.count; i++) {
    seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const c = palette[i % palette.length];
    tints.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
  const kind = set.kind === 'pollen' ? 0 : set.kind === 'leaf' ? 1 : 2;
  const m = lifeMaterial(vert, frag, {
    uLifeT: WIND.uLifeT,
    uWindDir: WIND.uWindDir,
    uCenter: center,
    uBox: { value: new THREE.Vector3(...set.box) },
    uKind: { value: kind },
  }, {
    side: THREE.DoubleSide,
    blending: set.kind === 'firefly' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData.kind = set.kind;
  return mesh;
}

export const AirMotes: React.FC = () => {
  const center = useRef({ value: new THREE.Vector3() });
  const meshes = useMemo(() => SETS.map((s) => buildSet(s, center.current)), []);

  useFrame(() => {
    center.current.value.copy(LIFE.player);
    const night = LIFE_UNIFORMS.uNight.value;
    // Sin dibujar lo que no se ve: las luciérnagas de día y el polen de noche no cuestan nada.
    for (const m of meshes) m.visible = m.userData.kind === 'firefly' ? night > 0.02 : night < 0.97;
  });

  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>;
};
