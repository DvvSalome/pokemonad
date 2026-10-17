import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { heightAt, pathDist, naturalGroundColor, WATER_Y } from '../terrain';
import { LIFE, lifeMaterial } from './lifeState';
import { WIND } from './wind';

// Polvo y briznas que levanta el jugador al correr. Un anillo de partículas en GPU: la CPU solo escribe
// la partícula al nacer (origen, velocidad, hora de nacimiento) y el vertex shader la anima entera, así
// que un frame sin pasos no cuesta nada y ninguno reserva memoria.
//
// Por el camino sale polvo; por la hierba, polvo más tenue y briznas sueltas que saltan y caen.

const POOL = 72;
const RUN_SPEED = 11;
const WALK_SPEED = 1.2;

const vert = /* glsl */ `
uniform float uT;
uniform float uLifeT;
uniform vec2 uWindDir;
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aInfo; // nacimiento, vida, tamaño, tipo (0 polvo, 1 brizna)
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
varying vec3 vColor;
void main() {
  float age = uT - aInfo.x;
  float t = age / aInfo.y;
  vUv = uv;
  vKind = aInfo.w;
  vColor = aColor;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  vec3 p;
  float size;
  float rot = 0.0;
  vec2 drift = uWindDir * age * 0.5;
  if (aInfo.w < 0.5) {
    // El polvo frena en seguida (arrastre exponencial), sube despacio y se deja llevar por el viento.
    p = aOrigin + aVel * (1.0 - exp(-age * 3.2)) / 3.2 + vec3(drift.x, age * 0.32, drift.y);
    size = aInfo.z * (0.45 + 1.25 * sqrt(t));
    vAlpha = (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.06, t) * 0.55;
  } else {
    p = aOrigin + aVel * age + vec3(drift.x, -5.2 * age * age, drift.y);
    p.y = max(p.y, aOrigin.y - 0.02);
    size = aInfo.z;
    rot = age * (6.0 + aVel.x * 3.0);
    vAlpha = 1.0 - smoothstep(0.65, 1.0, t);
  }
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  vec2 q = position.xy;
  if (aInfo.w > 0.5) q = vec2(q.x * 0.28, q.y); // brizna: tira fina
  float c = cos(rot), s = sin(rot);
  mvPosition.xy += mat2(c, s, -s, c) * q * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
varying vec3 vColor;
void main() {
  vec2 d = vUv - 0.5;
  float a;
  vec3 col = vColor;
  if (vKind < 0.5) {
    // Nube de tres lóbulos con borde algo suave: un disco con degradado radial, sobre la sombra, se
    // leía como un foco de luz. La orientación de los lóbulos varía por partícula.
    float o = vColor.g * 37.0;
    vec2 k1 = vec2(cos(o), sin(o)) * 0.14, k2 = vec2(cos(o + 2.1), sin(o + 2.1)) * 0.14, k3 = vec2(cos(o + 4.2), sin(o + 4.2)) * 0.14;
    float r = min(min(length(d - k1), length(d - k2)), length(d - k3)) / 0.26;
    a = smoothstep(1.0, 0.7, r);
  } else {
    a = step(length(vec2(d.x, d.y * 0.55)), 0.5);
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * uLight, a);
  #include <fog_fragment>
}`;

const tmp = new THREE.Color();
const leafA = new THREE.Color(0x5b8f45);
const leafB = new THREE.Color(0x8bab5a);
const dust = new THREE.Color(0xc9bb98);
const fleck = new THREE.Color();

export const Footsteps: React.FC = () => {
  const uT = useRef({ value: 0 });
  const state = useRef({ next: 0, cursor: 0, stepT: 0, side: 1 });

  const { mesh, attrs } = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    g.instanceCount = POOL;
    const attrs = {
      origin: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3),
      vel: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3),
      info: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4).fill(-99), 4),
      color: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3),
    };
    for (const a of Object.values(attrs)) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOrigin', attrs.origin);
    g.setAttribute('aVel', attrs.vel);
    g.setAttribute('aInfo', attrs.info);
    g.setAttribute('aColor', attrs.color);
    const m = lifeMaterial(vert, frag, { uT: uT.current, uLifeT: WIND.uLifeT, uWindDir: WIND.uWindDir });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return { mesh, attrs };
  }, []);

  useFrame((_, delta) => {
    const now = uT.current.value + Math.min(delta, 0.1);
    uT.current.value = now;
    const st = state.current;
    const sp = LIFE.speed;
    if (sp < WALK_SPEED) { st.stepT = 0; return; }
    const running = sp > RUN_SPEED;
    // Cadencia de paso: más rápida corriendo. Cada pisada alterna pie.
    st.stepT += Math.min(delta, 0.1);
    const interval = running ? 0.17 : 0.34;
    if (st.stepT < interval) return;
    st.stepT = 0;
    st.side = -st.side;

    const p = LIFE.player;
    if (p.y < WATER_Y + 0.05) return;
    const hx = LIFE.heading.x, hz = LIFE.heading.y;
    const fx = p.x - hz * 0.16 * st.side, fz = p.z + hx * 0.16 * st.side;
    const onPath = pathDist(fx, fz) < 1.6;
    const fy = heightAt(fx, fz) + 0.05;
    naturalGroundColor(fx, fz, fy, tmp);
    // El polvo es el suelo aclarado, no un gris genérico: en el camino ocre, en la hierba verdoso.
    tmp.lerp(dust, onPath ? 0.4 : 0.3).multiplyScalar(0.92);

    const spawn = (kind: number, vx: number, vy: number, vz: number, life: number, size: number, col: THREE.Color) => {
      const i = st.cursor;
      st.cursor = (st.cursor + 1) % POOL;
      attrs.origin.setXYZ(i, fx + (Math.random() - 0.5) * 0.12, fy, fz + (Math.random() - 0.5) * 0.12);
      attrs.vel.setXYZ(i, vx, vy, vz);
      attrs.info.setXYZW(i, now, life, size, kind);
      attrs.color.setXYZ(i, col.r, col.g, col.b);
    };

    if (running || onPath) {
      const puffs = running ? (onPath ? 3 : 2) : 1;
      for (let k = 0; k < puffs; k++) {
        const a = Math.random() * Math.PI * 2;
        // Hacia atrás y a los lados, que es a donde patea el pie.
        spawn(0, -hx * 1.1 + Math.cos(a) * 0.7, 0.25, -hz * 1.1 + Math.sin(a) * 0.7,
          0.6 + Math.random() * 0.35, (onPath ? 0.8 : 0.55) * (0.8 + Math.random() * 0.4), tmp);
      }
    }
    if (!onPath) {
      const flecks = running ? 3 : Math.random() < 0.5 ? 1 : 0;
      for (let k = 0; k < flecks; k++) {
        const a = Math.random() * Math.PI * 2;
        const c = fleck.copy(leafA).lerp(leafB, Math.random());
        spawn(1, -hx * 0.9 + Math.cos(a) * 0.8, 1.6 + Math.random() * 1.2, -hz * 0.9 + Math.sin(a) * 0.8,
          0.75 + Math.random() * 0.3, 0.1 + Math.random() * 0.05, c);
      }
    }
    attrs.origin.needsUpdate = true;
    attrs.vel.needsUpdate = true;
    attrs.info.needsUpdate = true;
    attrs.color.needsUpdate = true;
  });

  return <primitive object={mesh} />;
};
