// Estado de la cámara orbital, compartido entre el rig (que la posiciona) y el jugador (que se mueve en
// relación a hacia dónde mira). Objeto mutable leído/escrito una vez por frame — mismo patrón ref-first
// que lighting.ts y toon.ts: meterlo en estado de React provocaría un re-render por frame.
//
// Valores calcados de research/pokegrass-source/js/player.js (`cam`) y js/camera.js, para que la cámara
// se sienta igual que la del PokeGrass original.

export const MIN_DIST = 6;
export const MAX_DIST = 30;
/** Límites de inclinación en radianes: 0.22 ≈ 13° (casi rasante) a 1.25 ≈ 72° (casi cenital). */
export const MIN_PITCH = 0.22;
export const MAX_PITCH = 1.25;

/** En vertical (móvil) la cámara arranca más lejos para que quepa algo de mundo en pantalla. */
const startDist = () =>
  typeof window !== 'undefined' && window.innerWidth / window.innerHeight < 0.8 ? 21 : 15;

export const orbit = {
  /** Ángulo horizontal en radianes. π = cámara detrás del jugador (el arranque del original). */
  yaw: Math.PI,
  /** Ángulo vertical sobre la horizontal. */
  pitch: 0.8,
  /** Distancia al jugador. */
  distance: startDist(),
};

/**
 * Corte de cámara pendiente. Al entrar o salir del estadio la cámara salta de sitio detrás de la
 * cortinilla; sin corte, el suavizado la haría cruzar volando media región a la vista.
 */
export const camCtl = { cut: false };

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Vector unitario "hacia adelante" en XZ según el yaw: alejándose de la cámara. Es la base del movimiento
 * relativo a cámara — W siempre empuja al personaje hacia el fondo de la pantalla, gire como gire la vista.
 */
export function forwardFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Vector unitario "a la derecha", perpendicular al de adelante (mismo despeje que el original). */
export function rightFromYaw(yaw: number): { x: number; z: number } {
  const f = forwardFromYaw(yaw);
  return { x: -f.z, z: f.x };
}
