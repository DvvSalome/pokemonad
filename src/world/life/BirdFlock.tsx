import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { LIFE, LIFE_UNIFORMS, lifeMaterial } from './lifeState';
import { WIND } from './wind';

// Bandada que de vez en cuando entra desde el horizonte, da una vuelta y media en espiral sobre el
// jugador y se vuelve a ir. Solo de día. Siluetas simples (cuerpo + dos alas) animadas en el shader;
// entre vuelos la malla no se dibuja.

const BIRDS = 11;
const DURATION = 42;

const vert = /* glsl */ `
uniform float uLifeT;
uniform vec4 uFlight; // xz centro, z inicio, w sentido de giro
attribute vec4 aSlot; // desplazamiento en formación (lado, detrás, arriba), fase
attribute float aTip;
varying float vFade;
vec3 orbit(float s, float ph) {
  float ang = uFlight.w * (s * 5.4 + ph * 0.02);
  // Entra lejos, se acerca a ~55 m y se aleja: el radio sigue una parábola con el mínimo a mitad.
  float r = 42.0 + 160.0 * pow(2.0 * s - 1.0, 2.0);
  return vec3(uFlight.x + cos(ang) * r, 27.0 + 6.0 * sin(s * 6.28 + 1.0), uFlight.y + sin(ang) * r);
}
void main() {
  float s = (uLifeT - uFlight.z) / ${DURATION.toFixed(1)};
  float ph = aSlot.w;
  vec3 c = orbit(s, ph);
  vec3 fwd = normalize(orbit(s + 0.002, ph) - c);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  // Cada pájaro ondula un poco dentro de la formación, si no la bandada se lee como un sólido rígido.
  vec3 slot = aSlot.xyz + vec3(sin(uLifeT * 0.7 + ph * 5.0), sin(uLifeT * 0.9 + ph * 3.0) * 0.6, cos(uLifeT * 0.5 + ph * 7.0)) * 1.2;
  c += right * slot.x - fwd * slot.y + up * slot.z;
  float flapOn = smoothstep(-0.3, 0.3, sin(uLifeT * 0.6 + ph * 11.0));
  float flap = sin(uLifeT * 9.0 + ph * 23.0) * mix(0.12, 0.85, flapOn);
  vec3 lp = position;
  lp.y += aTip * flap * 0.9;
  vec3 p = c + (right * lp.x + up * lp.y + fwd * lp.z) * 1.1;
  vFade = smoothstep(0.0, 0.05, s) * smoothstep(1.0, 0.95, s);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
varying float vFade;
void main() {
  if (vFade < 0.02) discard;
  gl_FragColor = vec4(vec3(0.2, 0.21, 0.25) * (0.6 + 0.4 * uLight), 1.0);
  #include <fog_fragment>
}`;

function birdGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  // Silueta de gaviota: alas en V abierta con la punta echada atrás, y un cuerpo fino.
  const pos = [
    0, 0, 0.4, 0, 0, -0.4, 0.05, 0, 0.05, -0.05, 0, 0.05, // cuerpo: punta, cola, dos laterales
    -0.1, 0, 0.26, -0.55, 0.08, 0.12, -0.5, 0.05, -0.12, -0.1, 0, -0.18, -1.05, 0.02, -0.34, // ala izq
    0.1, 0, 0.26, 0.55, 0.08, 0.12, 0.5, 0.05, -0.12, 0.1, 0, -0.18, 1.05, 0.02, -0.34, // ala der
  ];
  // Peso del aleteo: la raíz fija, el codo a medias, la punta entera.
  const tip = [0, 0, 0, 0, 0, 0.5, 0.5, 0, 1, 0, 0.5, 0.5, 0, 1];
  const idx = [0, 2, 3, 1, 2, 3];
  for (const b of [4, 9]) idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 1, b + 4, b + 2);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  g.setIndex(idx);
  const slots = new Float32Array(BIRDS * 4);
  for (let i = 0; i < BIRDS; i++) {
    // V: el líder delante y los demás alternando a cada lado, cada fila más atrás.
    const row = Math.ceil(i / 2);
    const side = i === 0 ? 0 : i % 2 ? -1 : 1;
    slots.set([side * row * 3.0 + (Math.random() - 0.5), row * 2.6 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2, Math.random() * 10], i * 4);
  }
  g.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 4));
  g.instanceCount = BIRDS;
  return g;
}

export const BirdFlock: React.FC = () => {
  const uFlight = useRef({ value: new THREE.Vector4(0, 0, -999, 1) });
  const clock = useRef({ t: 0, next: 9 });

  const mesh = useMemo(() => {
    const m = lifeMaterial(vert, frag, { uFlight: uFlight.current, uLifeT: WIND.uLifeT }, { transparent: false, depthWrite: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(birdGeometry(), m);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }, []);

  useFrame((_, delta) => {
    const c = clock.current;
    c.t += Math.min(delta, 0.1);
    const f = uFlight.current.value;
    const shared = WIND.uLifeT.value;
    if (c.t >= c.next && LIFE_UNIFORMS.uNight.value < 0.4) {
      f.set(LIFE.player.x + (Math.random() - 0.5) * 30, LIFE.player.z + (Math.random() - 0.5) * 30, shared, Math.random() < 0.5 ? -1 : 1);
      c.next = c.t + DURATION + 25 + Math.random() * 45;
    }
    mesh.visible = shared - f.z < DURATION;
  });

  return <primitive object={mesh} />;
};
