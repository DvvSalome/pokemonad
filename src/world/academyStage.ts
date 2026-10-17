// Estado compartido del escenario del Coliseo Monad, SIN dependencias de wallet ni de React.
//
// Lo leen tres sitios que no deben conocerse entre sí: el jugador (Player.tsx, que se planta en su marca
// de la arena), la cámara del mundo (CameraRig.tsx, que tiene que callarse mientras manda la del duelo) y
// la propia escena del coliseo (AcademyArena.tsx). Va en un módulo aparte, y no dentro de academyStore,
// para que importar "¿está la arena activa?" no arrastre viem ni la lógica del combate a esos archivos.
//
// Mismo patrón ref-first que arenaLayout.stage en el combate original: un objeto mutable que se escribe
// y se lee una vez por frame, porque un golpe dura 0.4 s y meterlo en estado de React provocaría un
// re-render por frame.
import { COLISEUM, COLISEUM_BY_KEY, arenaY } from './terrain';

/** La sede del módulo educativo: el coliseo morado de la Meseta del Trueno. */
export const MONAD_SITE = 'bolt';
const site = () => COLISEUM_BY_KEY[MONAD_SITE];

/** Un punto en coordenadas locales del recinto (el portón al oeste, −x), llevado al mundo. */
export function toWorld(lx: number, lz: number): [number, number] {
  const s = site();
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
}

/**
 * Las dos marcas del duelo, en coordenadas locales. No están en línea recta a propósito: la cámara se
 * pone detrás de uno de los dos, y alineados el de delante taparía al de atrás. Lo que abre el plano es
 * ese pequeño desvío, no girar la cámara.
 */
export const LOCAL = {
  player: [-COLISEUM.floor * 0.3, COLISEUM.floor * 0.09] as const,
  boss: [COLISEUM.floor * 0.32, -COLISEUM.floor * 0.06] as const,
};

export interface Mark { x: number; z: number; y: number }

/**
 * Guion de la presentación, en segundos desde que la escena pasa a la arena (misma estructura que
 * arenaLayout.INTRO del combate original): vuelo aéreo sobre las gradas, cartel VS a pantalla completa,
 * el jefe emerge de la pista, travelling hacia él, corte al jugador que enciende su sello, plano general.
 */
export const INTRO = { vsAt: 0.25, vsSlam: 0.62, vsEnd: 1.75, bossAt: 1.95, dollyAt: 2.45, playerAt: 3.4, end: 4.5 };

export type Pose = 'idle' | 'attack' | 'hurt' | 'win' | 'lose';

export interface Body { lunge: number; knock: number; knockV: number }

export const ACADEMY = {
  /** La escena está mostrando la arena (no el mundo). */
  active: false,
  /** Dónde está cada uno ahora mismo en el mundo: se rellena al entrar (ver placeMarks). */
  player: { x: 0, z: 0, y: 0 } as Mark,
  boss: { x: 0, z: 0, y: 0 } as Mark,
  /** Hacia dónde mira el jugador (convención de GLTFAvatar: atan2(dx, dz)). */
  facing: 0,
  /** Centro de la arena, para que la luz y las partículas del mundo la sigan. */
  center: { x: 0, z: 0 },
};

/** Fija las marcas del duelo en el mundo. Se llama al entrar, cuando ya se sabe la cota de la sede. */
export function placeMarks() {
  const y = arenaY(site());
  const [px, pz] = toWorld(LOCAL.player[0], LOCAL.player[1]);
  const [bx, bz] = toWorld(LOCAL.boss[0], LOCAL.boss[1]);
  ACADEMY.player = { x: px, z: pz, y };
  ACADEMY.boss = { x: bx, z: bz, y };
  ACADEMY.facing = Math.atan2(bx - px, bz - pz);
  ACADEMY.center = { x: site().x, z: site().z };
}

/** El reloj y las señales de golpe del escenario. */
export const fx = {
  /** Segundos de escenario desde que se abrió la arena (los avanza AcademyStage a la velocidad de `speed`). */
  t: 0,
  /** 1 normal, casi 0 en la pausa del impacto, lenta en el K.O. */
  speed: 1,
  /** Segundos reales que queda congelada la acción (pausa de impacto). */
  freeze: 0,
  /** Segundos reales de cámara lenta que quedan (golpe final). */
  slow: 0,
  /** Golpe de zoom de la cámara (0..1, decae solo). */
  kick: 0,
  /** Sacudida de cámara (0..1, decae sola). */
  shake: 0,
  /** Pose que debe tener el avatar del jugador: la lee Player.tsx. */
  pose: 'idle' as Pose,
  /** Segundos de escenario desde que empezó el golpe en curso (0 si no hay), y su número. Los efectos los leen. */
  animT: 0,
  animId: 0,
  player: { lunge: 0, knock: 0, knockV: 0 } as Body,
  boss: { lunge: 0, knock: 0, knockV: 0 } as Body,
  bossKey: null as string | null,
  /** Altura de cada uno en metros, para colocar cámaras y cifras. */
  height: { player: 1.8, boss: 4 },
};

/** Paso de tiempo del escenario: respeta la pausa de impacto y la cámara lenta. */
export const stageDt = (dtReal: number) => Math.min(dtReal, 0.05) * fx.speed;

export function resetStage() {
  fx.t = 0; fx.speed = 1; fx.freeze = 0; fx.slow = 0; fx.kick = 0; fx.shake = 0;
  fx.pose = 'idle'; fx.animT = 0; fx.animId = 0;
  fx.player.lunge = fx.player.knock = fx.player.knockV = 0;
  fx.boss.lunge = fx.boss.knock = fx.boss.knockV = 0;
}

/** Tiempos de cada golpe: el atacante carga y lanza (wind) y llega al rival (impact). Iguales al original. */
export const WIND_MS = 640;
export const IMPACT_MS = 880;
export const KO_EXTRA_MS = 1500;
export const GAP_MS = 180;
