import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { heightAt } from '../terrain';
import { coverSeeds } from '../GroundCover';
import { LIFE_UNIFORMS, lifeMaterial } from './lifeState';
import { WIND } from './wind';

// Mariposas revoloteando sobre las manchas de flores de la cubierta (GroundCover), solo de día.
// Una malla instanciada de dos alas; trayectoria, rumbo y aleteo salen del vertex shader, así que la
// CPU no hace nada por mariposa. Alas recortadas por discard (no transparencia): sin problemas de orden.

const MAX = 44;
const CELL = 9;

const vert = /* glsl */ `
uniform float uLifeT;
attribute vec4 aAnchor; // xyz ancla, w fase
attribute vec3 aColor;
attribute float aSide;
varying vec2 vUv;
varying vec3 vColor;
vec3 path(float t, float ph) {
  // Lissajous irregular: se aleja un par de metros de la flor y vuelve, con cabeceos de altura.
  float w = 0.55 + fract(ph * 7.13) * 0.35;
  return vec3(
    sin(t * w + ph * 6.28) * 1.7 + sin(t * w * 2.3 + ph) * 0.5,
    0.85 + 0.35 * sin(t * w * 1.7 + ph * 3.0) + 0.08 * sin(t * 11.0 + ph),
    cos(t * w * 0.83 + ph * 4.0) * 1.4 + cos(t * w * 2.9) * 0.4);
}
void main() {
  vUv = uv;
  vColor = aColor;
  float ph = aAnchor.w;
  float t = uLifeT;
  vec3 c = aAnchor.xyz + path(t, ph);
  vec3 ahead = aAnchor.xyz + path(t + 0.08, ph);
  vec3 fwd = ahead - c;
  fwd.y *= 0.3;
  fwd = normalize(fwd + vec3(1e-4, 0.0, 0.0));
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  // Aleteo rápido con pausas de planeo; el ala gira sobre el eje del cuerpo.
  float flap = sin(t * 17.0 + ph * 40.0);
  float glide = smoothstep(-0.2, 0.6, sin(t * 0.9 + ph * 9.0));
  // Planeando deja las alas en V abierta: planas se verían de canto y desaparecerían.
  float a = mix(0.9, 0.55 + flap * 0.95, glide);
  float span = position.x; // 0 en el cuerpo, 1 en la punta
  vec3 local = right * (aSide * span * cos(a)) + up * (span * sin(a)) + fwd * position.y;
  vec3 p = c + local * 0.34;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  // uv.x: del cuerpo a la punta; uv.y: de la cola a la cabeza. Ala delantera grande, trasera menor.
  vec2 f = vec2(vUv.x, vUv.y - 0.62) * vec2(1.0, 1.25);
  vec2 h = vec2(vUv.x * 1.25, vUv.y - 0.28) * vec2(1.0, 1.35);
  float fore = length(f - vec2(0.5, 0.05));
  float hind = length(h - vec2(0.42, 0.0));
  float inside = min(fore / 0.5, hind / 0.42);
  if (inside > 1.0) discard;
  vec3 col = vColor;
  // Borde y ocelo oscuros: lectura de mariposa sin textura. Nada claro encima del color, que se
  // leería como un brillo.
  col = mix(col, col * 0.35, smoothstep(0.78, 0.92, inside));
  col = mix(col, col * 0.45, smoothstep(0.1, 0.05, length(vUv - vec2(0.62, 0.72))));
  col = mix(col, vec3(0.16, 0.13, 0.1), step(vUv.x, 0.06));
  gl_FragColor = vec4(col * uLight, 1.0);
  #include <fog_fragment>
}`;

const PALETTE = [0xe8dcbc, 0xdcbc5a, 0xcf8a4e, 0x93b2cf, 0xdcd6c8, 0xc49aae].map((h) => new THREE.Color(h));

/** Un ejemplar por celda de CELL m con flores, para repartirlas por todas las manchas sin amontonar. */
function flowerAnchors(): { x: number; z: number }[] {
  const seen = new Set<string>();
  const out: { x: number; z: number }[] = [];
  for (const s of coverSeeds()) {
    if (!/Flower/.test(s.key)) continue;
    const k = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x: s.x, z: s.z });
  }
  // Barajado determinista para que el recorte a MAX no se quede solo con el primer bioma.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor((Math.sin(i * 91.7) * 0.5 + 0.5) * (i + 1)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, MAX);
}

function wingGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  // Dos alas, cada una un quad en (span 0..1, largo -0.5..0.5).
  const pos: number[] = [];
  const uv: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  for (const sd of [-1, 1]) {
    const b = pos.length / 3;
    pos.push(0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    side.push(sd, sd, sd, sd);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

export const Butterflies: React.FC = () => {
  const mesh = useMemo(() => {
    const anchors = flowerAnchors();
    const g = wingGeometry();
    g.instanceCount = anchors.length;
    const a = new Float32Array(anchors.length * 4);
    const col = new Float32Array(anchors.length * 3);
    anchors.forEach((p, i) => {
      a.set([p.x, heightAt(p.x, p.z), p.z, (i * 0.618034) % 1], i * 4);
      const c = PALETTE[i % PALETTE.length];
      col.set([c.r, c.g, c.b], i * 3);
    });
    g.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    const m = lifeMaterial(vert, frag, { uLifeT: WIND.uLifeT }, { transparent: false, depthWrite: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    return mesh;
  }, []);

  useFrame(() => {
    mesh.visible = LIFE_UNIFORMS.uNight.value < 0.6;
  });

  return <primitive object={mesh} />;
};
