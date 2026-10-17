// Planos de la portada: una secuencia de tomas de dron sobre la región (prado → coliseo → lago → cráter →
// ruinas) que se repite. Cada toma interpola posición y mirada con suavizado de entrada/salida y un fundido
// a oscuro entre tomas, como el modo "attract" de un juego de consola.
//
// Las alturas `y` son relativas al suelo en ese punto: el relieve cambia con los retoques del terreno y así
// una toma nunca queda enterrada en una ladera.
import * as THREE from 'three';
import { solidY, WATER_Y, ARENA, LAKE, PLAZA, CONE } from '../terrain';
import type { Key } from '../../i18n';

type P = [number, number, number];
export interface Shot {
  /** Duración en segundos. */
  d: number;
  from: { pos: P; look: P };
  to: { pos: P; look: P };
  /** Rótulo de lugar que la portada muestra durante la toma. */
  label: Key;
  /** Órbita opcional alrededor de `look` (radianes recorridos): sustituye la interpolación de posición. */
  orbit?: { r: number; a0: number; a1: number; y0: number; y1: number };
}

export const SHOTS: Shot[] = [
  // Grúa: arranca entre la hierba del spawn y sube hasta descubrir el prado y el coliseo al fondo.
  { d: 11, label: 'zone.meadow', from: { pos: [-5, 1.4, -4], look: [3, 1.6, 22] }, to: { pos: [-16, 21, -24], look: [16, 2, 38] } },
  { d: 11, label: 'intro.place.colosseum', from: { pos: [0, 0, 0], look: [ARENA.x, 2.5, ARENA.z] }, to: { pos: [0, 0, 0], look: [ARENA.x, 1.5, ARENA.z] }, orbit: { r: 46, a0: -2.3, a1: -1.2, y0: 22, y1: 14 } },
  // Travelling rasante por la orilla del lago con la isla de fondo.
  { d: 11, label: 'zone.lake', from: { pos: [-64, 5, 36], look: [LAKE.x, 0.5, LAKE.z + 4] }, to: { pos: [-74, 8, -12], look: [LAKE.x - 14, 1.5, LAKE.z - 6] } },
  // Sobre el cráter: la lava es lo más legible del norte (la cumbre lejana se pierde en la niebla).
  { d: 11, label: 'zone.volcano', from: { pos: [-44, 17, -62], look: [CONE.x, 2, CONE.z] }, to: { pos: [-58, 22, -58], look: [CONE.x - 6, 3, CONE.z - 4] } },
  { d: 10, label: 'zone.ruins', from: { pos: [0, 0, 0], look: [PLAZA.x, 2, PLAZA.z] }, to: { pos: [0, 0, 0], look: [PLAZA.x, 2, PLAZA.z] }, orbit: { r: 30, a0: -0.7, a1: 0.35, y0: 30, y1: 24 } },
];
export const LOOP = SHOTS.reduce((s, x) => s + x.d, 0);
/** Segundos de fundido a oscuro a cada lado del corte. */
export const DIP = 0.75;

export const smooth = (t: number) => t * t * (3 - 2 * t);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const ground = (x: number, z: number) => Math.max(solidY(x, z), WATER_Y);

/** Pose de la toma `i` en su instante `u` (0..1), escrita en pos/look. */
export function shotPose(i: number, u: number, pos: THREE.Vector3, look: THREE.Vector3) {
  const s = SHOTS[i];
  // Suavizado ligero: el movimiento nunca se detiene del todo (se notaría el "clavado" antes del corte).
  const e = 0.18 * u + 0.82 * smooth(u);
  const L = (a: P, b: P, k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k] as P;
  const lk = L(s.from.look, s.to.look, e);
  look.set(lk[0], lk[1] + ground(lk[0], lk[2]), lk[2]);
  if (s.orbit) {
    const o = s.orbit, a = o.a0 + (o.a1 - o.a0) * e;
    const x = lk[0] + Math.sin(a) * o.r, z = lk[2] + Math.cos(a) * o.r;
    pos.set(x, ground(x, z) + o.y0 + (o.y1 - o.y0) * e, z);
  } else {
    const p = L(s.from.pos, s.to.pos, e);
    // La altura relativa se toma del suelo en origen y destino (interpolado), no del punto actual: seguir
    // el relieve bajo la cámara la haría cabecear con cada loma.
    const g = ground(s.from.pos[0], s.from.pos[2]) * (1 - e) + ground(s.to.pos[0], s.to.pos[2]) * e;
    pos.set(p[0], g + p[1], p[2]);
  }
  pos.y = Math.max(pos.y, ground(pos.x, pos.z) + 1.2);
}

/** Toma y progreso para un tiempo de portada dado, y la opacidad del fundido a oscuro en ese instante. */
export function shotAt(time: number) {
  let t = ((time % LOOP) + LOOP) % LOOP, i = 0;
  while (t >= SHOTS[i].d) { t -= SHOTS[i].d; i++; }
  const d = SHOTS[i].d;
  const fade = Math.max(1 - smooth(Math.min(1, t / DIP)), 1 - smooth(Math.min(1, (d - t) / DIP)));
  return { i, u: t / d, fade };
}

/**
 * Puente entre la cámara de portada (dentro del Canvas) y el overlay DOM: se escribe cada frame y el
 * overlay se suscribe con `onFrame` para pintar el fundido sin re-renderizar React.
 */
export const titleFx = {
  shot: 0,
  fade: 1,
  onFrame: null as null | ((fade: number, shot: number) => void),
};
