// Campo de viento compartido por toda la vegetación: hierba procedural, cubierta del pack y árboles.
//
// Todo sale de la MISMA función GLSL evaluada en la posición de mundo de la base de cada planta, así
// que una ráfaga que entra por un lado del prado dobla primero la hierba, luego los arbustos y luego
// las copas, en ese orden espacial. Con un seno por capa (como antes) cada capa se movía a su aire y el
// conjunto no se leía como viento sino como temblor.
//
// Los uniforms son objetos compartidos: LivingWorld los escribe una vez por frame y todos los
// materiales los leen por referencia, sin tocar nada por material.
import * as THREE from 'three';

export const WIND = {
  uLifeT: { value: 0 },
  /** Dirección del viento en XZ, normalizada. Gira muy despacio (ver LivingWorld). */
  uWindDir: { value: new THREE.Vector2(0.86, 0.5) },
  /** xyz: pies del jugador. w: 1 si hay jugador que empuje la hierba, 0 si no. */
  uPlayer: { value: new THREE.Vector4(0, -999, 0, 0) },
};

export const WIND_GLSL = /* glsl */ `
uniform float uLifeT;
uniform vec2 uWindDir;
uniform vec4 uPlayer;

// Intensidad de ráfaga 0..1 en un punto. Dos trenes de onda que viajan a favor del viento, con el
// frente deformado a lo ancho para que no avancen como líneas rectas; pow() las deja cortas y marcadas,
// con prado tranquilo entre una y otra.
float lifeGust(vec2 p) {
  float a = dot(p, uWindDir);
  float c = dot(p, vec2(-uWindDir.y, uWindDir.x));
  float w1 = 0.5 + 0.5 * sin(a * 0.06 - uLifeT * 1.5 + sin(c * 0.04 + uLifeT * 0.11) * 2.4);
  float w2 = 0.5 + 0.5 * sin(a * 0.023 - uLifeT * 0.55 + c * 0.017);
  return pow(w1, 5.0) * (0.45 + 0.55 * w2);
}

// Desplazamiento de mundo para un vértice. hw es el peso de altura (0 en la raíz), amp los metros de
// flexión a peso 1 con ráfaga plena.
vec3 lifeWind(vec3 world, vec3 base, float hw, float amp, float seed) {
  float g = lifeGust(base.xz);
  float breeze = 0.28 + 0.12 * sin(uLifeT * 0.7 + dot(base.xz, uWindDir) * 0.09 + seed * 2.0);
  float flutter = sin(uLifeT * (2.3 + seed * 1.4) + seed * 6.2831) * (0.18 + g * 0.5);
  vec2 side = vec2(-uWindDir.y, uWindDir.x);
  vec2 d = (uWindDir * (breeze + g * 1.35) + side * flutter * 0.4) * amp * hw;
  return vec3(d.x, -length(d) * 0.3, d.y);
}

// Empuje del jugador: aparta lo que está a menos de ~1.5 m de sus pies, más cuanto más cerca.
vec3 lifePush(vec3 world, vec3 base, float hw, float amp) {
  vec2 d = base.xz - uPlayer.xz;
  float l = length(d);
  float k = (1.0 - smoothstep(0.35, 1.5, l)) * uPlayer.w * (1.0 - smoothstep(1.2, 2.2, abs(base.y - uPlayer.y)));
  vec2 dir = l > 1e-3 ? d / l : vec2(1.0, 0.0);
  vec2 p = dir * k * amp * hw;
  return vec3(p.x, -k * amp * hw * 0.55, p.y);
}
`;

export interface WindProfile {
  /** Metros de flexión por unidad de peso. */
  amp: number;
  /** Altura (m sobre la base) a la que el peso vale 1; el peso crece con el cuadrado de la altura. */
  ref: number;
  /** Cuánto aparta el jugador. 0 en árboles. */
  push: number;
  /** Aleteo rápido extra por vértice, para las cartas de hojas. */
  leafJitter: number;
}

export const WIND_PROFILES = {
  cover: { amp: 0.16, ref: 0.7, push: 0.32, leafJitter: 0 },
  tree: { amp: 0.15, ref: 11, push: 0, leafJitter: 0.035 },
} satisfies Record<string, WindProfile>;

export type WindKind = keyof typeof WIND_PROFILES;

const f = (n: number) => n.toFixed(4);

/** Sustituye project_vertex por una proyección en espacio de mundo con viento y empuje. */
function windProjectChunk(p: WindProfile, leaf: boolean): string {
  return `
    vec4 lifeW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      lifeW = instanceMatrix * lifeW;
      vec3 lifeBase = (modelMatrix * instanceMatrix[3]).xyz;
    #else
      vec3 lifeBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #endif
    lifeW = modelMatrix * lifeW;
    float lifeH = max(lifeW.y - lifeBase.y, 0.0) / ${f(p.ref)};
    float lifeHw = min(lifeH * lifeH, 2.0);
    float lifeSeed = fract(sin(dot(lifeBase.xz, vec2(12.9898, 78.233))) * 43758.5453);
    lifeW.xyz += lifeWind(lifeW.xyz, lifeBase, lifeHw, ${f(p.amp)}, lifeSeed);
    ${p.push > 0 ? `lifeW.xyz += lifePush(lifeW.xyz, lifeBase, min(lifeHw, 1.0), ${f(p.push)});` : ''}
    ${leaf ? `lifeW.xyz += vec3(sin(uLifeT * 5.1 + dot(lifeW.xyz, vec3(1.7, 2.3, 1.1))), 0.0,
      cos(uLifeT * 4.3 + dot(lifeW.xyz, vec3(2.1, 1.3, 1.9)))) * ${f(p.leafJitter)} * (0.4 + lifeGust(lifeBase.xz)) * min(lifeH, 1.5);` : ''}
    vec4 mvPosition = viewMatrix * lifeW;
    gl_Position = projectionMatrix * mvPosition;`;
}

type Compile = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/** Parchea un shader ya parcheado por su material de origen (toon u outline): se encadena, no lo pisa. */
export function patchWindShader(shader: THREE.WebGLProgramParametersWithUniforms, kind: WindKind, leaf: boolean): void {
  shader.uniforms.uLifeT = WIND.uLifeT;
  shader.uniforms.uWindDir = WIND.uWindDir;
  shader.uniforms.uPlayer = WIND.uPlayer;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WIND_GLSL}`)
    .replace('#include <project_vertex>', windProjectChunk(WIND_PROFILES[kind], leaf));
}

const LEAF_MATERIAL = /leaf|leaves|foliage/i;
const cache = new WeakMap<THREE.Material, Map<WindKind, THREE.Material>>();

/**
 * Variante con viento de un material. Clona y encadena onBeforeCompile a mano: Material.clone() no
 * conserva ni onBeforeCompile ni customProgramCacheKey, y sin ellos el clon perdería el shader toon. El
 * closure del original sigue apuntando a sus uniforms reales (oclusor, rim), así que se comparten.
 * Cacheado por material de origen: la misma malla del pack se reutiliza en muchas capas.
 */
export function windMaterial(src: THREE.Material, kind: WindKind): THREE.Material {
  let byKind = cache.get(src);
  if (!byKind) { byKind = new Map(); cache.set(src, byKind); }
  const hit = byKind.get(kind);
  if (hit) return hit;
  const m = src.clone();
  const prev = src.onBeforeCompile.bind(src) as Compile;
  const prevKey = src.customProgramCacheKey.bind(src);
  const leaf = kind === 'tree' && LEAF_MATERIAL.test(src.name || '');
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    patchWindShader(shader, kind, leaf);
  };
  m.customProgramCacheKey = () => `${prevKey()}|wind-${kind}${leaf ? '-leaf' : ''}`;
  byKind.set(kind, m);
  return m;
}

/** Aplica viento a las mallas que devuelve buildInstanced (incluidos los cascos de contorno). */
export function applyWind(objects: THREE.Object3D[], kind: WindKind): void {
  for (const o of objects) {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) continue;
    mesh.material = windMaterial(mesh.material, kind);
    // El vértice se desplaza fuera de la esfera de la geometría: margen para no recortar copas en el borde.
    if (mesh.isInstancedMesh && mesh.boundingSphere) mesh.boundingSphere.radius += WIND_PROFILES[kind].amp * 4;
  }
}
