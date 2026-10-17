import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { LIFE, LIFE_UNIFORMS, lifeMaterial } from './lifeState';
import { WIND } from './wind';

// Lo que flota en el aire alrededor del jugador: pavesas que suben, esquirlas de cristal que giran y,
// de noche, fuegos fatuos.
//
// Antes esto era polen, hojas y luciérnagas — el repertorio de un prado soleado. Esta región es otra
// cosa (volcanes, mazmorras, una isla de cristal), así que el aire también: brasas naranjas subiendo en
// corrientes térmicas, astillas minerales girando a contraluz y orbes de pantano que se encienden al
// anochecer. Es el detalle que más se mira sin darse cuenta, porque cruza la pantalla todo el rato.
//
// Cada partícula vive en una caja que viaja con el jugador y se envuelve con mod(): la que sale por un
// lado entra por el otro, así un puñado basta para llenar lo que ve la cámara. Los bordes de la caja se
// funden con la distancia para que el salto del envoltorio no se vea. Todo el movimiento es del
// shader; la CPU solo pasa la posición del jugador.

interface MoteSet {
  count: number;
  box: [number, number, number];
  kind: 'ember' | 'shard' | 'wisp';
}

const SETS: MoteSet[] = [
  { count: 90, box: [26, 9, 26], kind: 'ember' },
  { count: 26, box: [30, 10, 30], kind: 'shard' },
  { count: 90, box: [34, 3.2, 34], kind: 'wisp' },
];

const vert = /* glsl */ `
uniform float uLifeT;
uniform vec2 uWindDir;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uKind; // 0 pavesa, 1 esquirla, 2 fuego fatuo
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
    // Pavesa: sube en espiral lenta, acelerando un poco, y parpadea como una brasa.
    p.y += t * (0.55 + aSeed.w * 0.5);
    p.xz += uWindDir * t * 0.35;
    p.x += sin(t * 1.1 + ph) * 0.5;
    p.z += cos(t * 0.9 + ph * 1.7) * 0.5;
    vGlow = 0.45 + 0.55 * pow(max(0.0, sin(t * (3.0 + aSeed.w * 2.5) + ph * 5.0)), 2.0);
    size = (0.05 + aSeed.w * 0.045) * (0.75 + vGlow * 0.5);
  } else if (uKind < 1.5) {
    // Esquirla: cae muy despacio girando sobre sí misma, como un cristal suspendido.
    p.xz += uWindDir * t * 0.75;
    p.y -= t * 0.18;
    p.x += sin(t * 0.6 + ph) * 0.9;
    rot = t * (0.5 + aSeed.w * 0.9) + ph;
    // El escorzo va y viene: la esquirla casi desaparece de canto y vuelve a abrirse.
    squash = 0.18 + 0.82 * abs(cos(t * 0.8 + ph));
    size = 0.16 + aSeed.w * 0.12;
  } else {
    // Fuego fatuo: deriva muy lenta y respiración de brillo.
    p += vec3(sin(t * 0.23 + ph) * 2.2, sin(t * 0.41 + ph * 2.3) * 0.6, cos(t * 0.19 + ph * 1.3) * 2.2);
    vGlow = pow(max(0.0, sin(t * (0.6 + aSeed.w * 0.5) + ph * 3.0)), 2.0);
    size = 0.22 + 0.5 * vGlow;
  }
  vec3 lo = uCenter - uBox * vec3(0.5, 0.0, 0.5);
  p = lo + mod(p - lo, uBox);
  p.y += uKind > 1.5 ? 0.4 : 0.2;
  vec2 dc = (p.xz - uCenter.xz) / (uBox.xz * 0.5);
  float edge = 1.0 - smoothstep(0.6, 1.0, length(dc));
  float vfade = smoothstep(0.0, 0.08, (p.y - uCenter.y) / uBox.y);
  vAlpha = edge * vfade;
  // Las pavesas mandan de noche (el fuego se ve más), las esquirlas de día y los fatuos solo de noche.
  if (uKind > 1.5) vAlpha *= uNight;
  else if (uKind < 0.5) vAlpha *= 0.55 + 0.45 * uNight;
  else vAlpha *= 1.0 - uNight * 0.8;
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
    // Pavesa: punto incandescente con halo. Aditiva, así que el halo basta para que se lea de lejos.
    float core = smoothstep(0.18, 0.0, r);
    float halo = smoothstep(0.5, 0.0, r);
    col = vec4(vTint * (core * 1.8 + halo * halo * 0.9) * (0.4 + vGlow), 1.0);
  } else if (uKind < 1.5) {
    // Esquirla: rombo alargado con un filo claro por un lado, como una lasca de cristal.
    float shard = abs(d.x) * 3.4 + abs(d.y) * 1.25;
    if (shard > 0.62) discard;
    float edge = smoothstep(0.62, 0.42, shard);
    vec3 c = mix(vTint, vec3(1.0), 0.45 * edge * step(d.x, 0.0));
    col = vec4(c * uLight, 0.55 + 0.45 * edge);
  } else {
    // Fuego fatuo: anillo suave con el centro hueco — no es un punto más, es un orbe.
    float ring = smoothstep(0.42, 0.3, r) * smoothstep(0.1, 0.24, r);
    float glowHalo = smoothstep(0.5, 0.0, r);
    col = vec4(vTint * (ring * 1.3 + glowHalo * glowHalo * 0.5) * (0.25 + vGlow), 1.0);
  }
  col.a *= vAlpha;
  if (col.a < 0.01) discard;
  gl_FragColor = col;
  #include <fog_fragment>
}`;

const TINTS: Record<MoteSet['kind'], number[]> = {
  ember: [0xff9a3c, 0xffc46a, 0xff6a2c, 0xffd79a],
  shard: [0xbfe9ff, 0xd8c8ff, 0xeaf4ff, 0xa9d4f0],
  wisp: [0x7df0d0, 0x9ad8ff, 0xc8a8ff],
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
  const kind = set.kind === 'ember' ? 0 : set.kind === 'shard' ? 1 : 2;
  const m = lifeMaterial(vert, frag, {
    uLifeT: WIND.uLifeT,
    uWindDir: WIND.uWindDir,
    uCenter: center,
    uBox: { value: new THREE.Vector3(...set.box) },
    uKind: { value: kind },
  }, {
    side: THREE.DoubleSide,
    blending: set.kind === 'shard' ? THREE.NormalBlending : THREE.AdditiveBlending,
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
    // Sin dibujar lo que no se ve: los fuegos fatuos de día y las esquirlas de noche cerrada no cuestan
    // nada. Las pavesas se quedan siempre: son el hilo que mantiene el aire vivo a cualquier hora.
    for (const m of meshes) {
      if (m.userData.kind === 'wisp') m.visible = night > 0.02;
      else if (m.userData.kind === 'shard') m.visible = night < 0.97;
      else m.visible = true;
    }
  });

  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>;
};
