// Input de cámara, calcado del original (research/pokegrass-source/js/player.js): arrastrar con un dedo o
// el botón izquierdo orbita, la rueda acerca/aleja, y dos dedos hacen pinza para el zoom. Escribe en
// `orbit` (cameraStore) sin pasar por estado de React, así arrastrar no dispara re-renders.
//
// Se engancha al canvas, no a window: arrastrar sobre un panel del HUD (Dex, Caja, bolsa) o sobre el
// joystick no mueve la cámara, porque esos eventos no llegan hasta acá.
import { useEffect } from 'react';
import { orbit, clamp, MIN_DIST, MAX_DIST, MIN_PITCH, MAX_PITCH } from './cameraStore';

/** Radianes por píxel arrastrado (valores del original). */
const YAW_SENS = 0.0065;
const PITCH_SENS = 0.004;
/** Zona muerta: hasta no arrastrar 6 px no se empieza a girar, para no mover la vista en un toque. */
const DEAD_ZONE = 6;
/** La rueda cambia la distancia un 10% por muesca, sin importar la magnitud del delta. */
const ZOOM_FACTOR = 0.1;

interface Ptr { x: number; y: number; x0: number; y0: number; moved: boolean }

export function useCameraInput(canvas: HTMLCanvasElement | null) {
  useEffect(() => {
    if (!canvas) return;

    const pointers = new Map<number, Ptr>();
    // Instantánea al bajar el segundo dedo: la pinza se calcula contra ella, no frame a frame, para que
    // el zoom no derive mientras dura el gesto (así lo hace el original).
    let pinch0 = 0;
    let dist0 = orbit.distance;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // botón derecho libre para el navegador
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        dist0 = orbit.distance;
      }
      canvas.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0 && d > 0) orbit.distance = clamp(dist0 * (pinch0 / d), MIN_DIST, MAX_DIST);
        return;
      }

      if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > DEAD_ZONE) p.moved = true;
      if (!p.moved) return;

      // Arrastrar a la derecha gira la vista a la derecha; hacia abajo sube la cámara (mirada cenital).
      orbit.yaw -= dx * YAW_SENS;
      orbit.pitch = clamp(orbit.pitch + dy * PITCH_SENS, MIN_PITCH, MAX_PITCH);
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch0 = 0;
      canvas.releasePointerCapture?.(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbit.distance = clamp(orbit.distance * (1 + Math.sign(e.deltaY) * ZOOM_FACTOR), MIN_DIST, MAX_DIST);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [canvas]);
}
