// Reparto de tiempos (ms) de la animación de captura. captureStore espera estos plazos entre fases y
// CaptureBall/Monsters los animan con los mismos números: cambiarlos aquí mantiene ambos lados en sincronía.
export const THROW_MS = 720;
/** Impacto, tapa abierta, rayo y el monstruo hecho luz entrando. Si el servidor tarda más, la bola espera flotando. */
export const ABSORB_MS = 1150;
/** Caída al suelo con rebote antes del primer temblor. */
export const DROP_MS = 560;
/** Un temblor: SWING de vaivén y el resto en silencio (la tensión está en la pausa). */
export const WOBBLE_MS = 760;
export const SWING_MS = 380;
export const SHAKE_TAIL_MS = 280;
export const shakeMs = (shakes: number) => DROP_MS + Math.max(1, shakes) * WOBBLE_MS + SHAKE_TAIL_MS;
/** Celebración en 3D (clic, estrellas) antes de que salga la carta. */
export const CAUGHT_HOLD_MS = 1350;
/** La bola revienta y el monstruo se rematerializa, enfadado. */
export const BROKE_MS = 1200;

/** Momentos clave dentro de la fase absorb (s). */
export const AB = {
  hit: 0, hover: 0.3, open: 0.2, beam: 0.24, glow: 0.26, pullFrom: 0.42, pullTo: 0.95, snap: 0.98,
} as const;
