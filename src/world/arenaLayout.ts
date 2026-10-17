// Dónde se pone cada cosa en el estadio. Lo leen el jugador (se planta detrás de su monstruo), los
// combatientes, los efectos y la cámara de combate.
//
// Los dos monstruos se enfrentan sobre el eje X: el del jugador al este, el salvaje al oeste. Todos los
// planos de cámara viven en el lado sur (-Z), que cae dentro del claro del punto de aparición (SPAWN,
// radio 11 sin árboles): así ningún plano puede acabar metido en una copa. Mirando desde el sureste, el
// monstruo del jugador queda cerca y a la izquierda y el salvaje al fondo a la derecha — el encuadre de
// siempre de la saga.
import * as THREE from 'three';
import { ARENA, arenaY, COLISEUM_SCALE } from './terrain';
import type { BattleSide } from './battleStore';

/** Lado del jugador sobre el eje X (+1 = este). Los planos de cámara se escriben relativos a él. */
export const EAST = 1;

// Las distancias crecen con la pista: en una arena del doble de radio, dos combatientes a 2.7 m del
// centro se verían pegados en mitad de un descampado.
const K = COLISEUM_SCALE;
export const SPOT: Record<BattleSide | 'trainer', { x: number; z: number }> = {
  player: { x: ARENA.x + 2.7 * K * EAST, z: ARENA.z },
  foe: { x: ARENA.x - 2.7 * K * EAST, z: ARENA.z },
  // En primer plano abajo a la izquierda del plano general: de espaldas, detrás de su monstruo.
  trainer: { x: ARENA.x + 4.1 * K * EAST, z: ARENA.z - 0.3 * K },
};

/**
 * Guion de la presentación, en segundos desde que se abre el estadio: vuelo aéreo sobre las gradas, el
 * salvaje aparece, travelling hacia él, corte al entrenador que lanza la bola y sale el monstruo del
 * jugador. Lo comparten la cámara, los combatientes, los efectos, el cartel de la UI y el sonido.
 * `vsAt`–`vsEnd`: el cartel VS a pantalla completa (tapa el arranque del vuelo; se abre sobre el descenso).
 */
export const INTRO = { vsAt: 0.25, vsSlam: 0.62, vsEnd: 1.75, foeAt: 1.95, dollyAt: 2.45, trainerAt: 3.4, ballAt: 3.5, ballEnd: 4.0, end: 4.7 };

export const other = (s: BattleSide): BattleSide => (s === 'player' ? 'foe' : 'player');

/** Hacia dónde mira cada combatiente (convención de GLTFAvatar: atan2(dx, dz), modelos mirando a +Z). */
export const facing = (s: BattleSide) => {
  const a = SPOT[s], b = SPOT[other(s)];
  return Math.atan2(b.x - a.x, b.z - a.z);
};

/** Punto del mundo a cierta altura sobre la pista, junto a una posición del estadio. */
export const stagePoint = (p: { x: number; z: number }, h = 0, out = new THREE.Vector3()) =>
  out.set(p.x, arenaY() + h, p.z);

/** Altura de cada combatiente en metros según su rareza: un Epic tiene que imponer. */
export const FIGHTER_HEIGHT: Record<string, number> = { Common: 1.45, Uncommon: 1.65, Rare: 1.9, Epic: 2.2, Legendary: 2.5 };

/**
 * Estado compartido por frame entre combatientes, efectos y cámara (mismo patrón ref-first que
 * lighting.ts): dónde está cada uno ahora mismo — el atacante se desplaza al embestir — y cuánto tiembla
 * la cámara.
 */
export const stage = {
  pos: { player: new THREE.Vector3(), foe: new THREE.Vector3() } as Record<BattleSide, THREE.Vector3>,
  height: { player: 1.5, foe: 1.5 } as Record<BattleSide, number>,
  shake: 0,
  /** Golpe de zoom de la cámara (0..1, decae solo): críticos y KO cierran el plano un instante. */
  kick: 0,
  /** Segundos de estadio desde que se abrió (lo avanza BattleStage, a la velocidad de `speed`). */
  t: 0,
  /** Velocidad del tiempo del estadio: 1 normal, casi 0 en la pausa del impacto, lenta en el KO. */
  speed: 1,
  /** Segundos reales que queda congelada la acción (pausa de impacto). */
  freeze: 0,
  /** Segundos reales de cámara lenta que quedan (golpe final). */
  slow: 0,
};

/** Paso de tiempo del estadio para este frame: combatientes, efectos y partículas lo usan en vez del real. */
export const stageDt = (dtReal: number) => Math.min(dtReal, 0.05) * stage.speed;
