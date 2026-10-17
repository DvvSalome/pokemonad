// Estado compartido de la capa de vida (fauna, partículas, viento). Mutable y leído por ref, como
// lighting.ts: se escribe una vez por frame en LivingWorld y lo leen los useFrame de cada sistema.
import * as THREE from 'three';

export const LIFE = {
  /** Pies del jugador en mundo. */
  player: new THREE.Vector3(),
  /** Velocidad horizontal suavizada, m/s. */
  speed: 0,
  /** Dirección de marcha en XZ (normalizada; la última válida si está quieto). */
  heading: new THREE.Vector2(0, 1),
  /** 0 de día, 1 de noche cerrada. */
  night: 0,
};

/** Uniforms compartidos por los ShaderMaterial de la capa. uLight imita la luz de la escena (flatLight). */
export const LIFE_UNIFORMS = {
  uLight: { value: new THREE.Color(1, 1, 1) },
  uNight: { value: 0 },
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Noche a partir de la hora local, la misma fuente que usa DayNightCycle. Se calcula aparte en vez de
 * deducirla de la intensidad del sol porque esa curva se reajusta a menudo, y la fauna no debería
 * cambiar de turno cada vez que alguien retoca la luz.
 */
export function nightAt(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60;
  return h < 12 ? 1 - smooth(5, 6.6, h) : smooth(18.6, 20.6, h);
}

/** Cabecera GLSL común: uniforms de vida + fog. Los ShaderMaterial de la capa la anteponen. */
export const LIFE_VERT_HEAD = /* glsl */ `
uniform vec3 uLight;
uniform float uNight;
#include <fog_pars_vertex>
`;

export const LIFE_FRAG_HEAD = /* glsl */ `
uniform vec3 uLight;
uniform float uNight;
#include <fog_pars_fragment>
`;

/**
 * ShaderMaterial con niebla de escena y los uniforms compartidos enlazados por referencia (merge()
 * los clonaría y dejarían de actualizarse).
 */
export function lifeMaterial(
  vertexShader: string,
  fragmentShader: string,
  shared: Record<string, THREE.IUniform>,
  opts: Partial<THREE.ShaderMaterialParameters> = {},
): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  Object.assign(uniforms, LIFE_UNIFORMS, shared);
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: LIFE_VERT_HEAD + vertexShader,
    fragmentShader: LIFE_FRAG_HEAD + fragmentShader,
    fog: true,
    transparent: true,
    depthWrite: false,
    ...opts,
  });
}
