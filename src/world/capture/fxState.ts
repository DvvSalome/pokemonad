// Estado por frame compartido entre la bola (CaptureBall, que dirige la animación) y el monstruo activo
// (Monsters, que se disuelve en luz). Mutable a propósito: se lee en useFrame sin provocar re-render.
import * as THREE from 'three';

export const capFx = {
  /** Boca de la bola en el mundo: hacia aquí se encoge el monstruo. */
  ball: new THREE.Vector3(),
  /** 0 = monstruo entero, 1 = dentro de la bola. */
  dissolve: 0,
  /** 0..1: cuánto se ha convertido en luz. */
  glow: 0,
  /** 0..1: sacudida de enfado al escaparse. */
  annoy: 0,
  tint: new THREE.Color(0xcfe9ff),
  /** Centro actual del cuerpo del monstruo (lo escribe Monsters) y su centro en reposo. */
  body: new THREE.Vector3(),
  rest: new THREE.Vector3(),
  size: 1,
};
