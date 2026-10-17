// Cámara de las pantallas de inicio: en 'title' encadena las tomas de dron de intro/shots.ts; en 'select'
// baja hasta el pedestal del spawn donde espera el personaje elegido. El paso entre modos es un vuelo en
// arco (sube por encima de ambos extremos) en vez de un lerp recto, que cruzaría montañas y árboles.
// Escribe el punto de mira en focusRef (sombras y partículas lo siguen) y en playerPos (los monstruos se
// muestran/ocultan por cercanía a él), igual que haría el jugador.
import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Posicion3DPlano } from '../engine/runtime/movimiento';
import { solidY, standY, WATER_Y, SPAWN } from './terrain';
import { playerPos } from './wildStore';
import { shotAt, shotPose, titleFx, easeInOutCubic } from './intro/shots';

export type TitleMode = 'title' | 'select';

/** Pose del plano de selección: la cámara al norte del pedestal, con el personaje a la izquierda del encuadre. */
export const PEDESTAL = { x: SPAWN.x - 1.8, z: SPAWN.z - 2.4 };
export const selectPose = () => {
  const gy = standY(PEDESTAL.x, PEDESTAL.z) + 0.34;
  return {
    pos: new THREE.Vector3(PEDESTAL.x - 1.95, gy + 1.9, PEDESTAL.z - 7.2),
    look: new THREE.Vector3(PEDESTAL.x - 1.55, gy + 0.95, PEDESTAL.z),
  };
};
/** Duración del vuelo entre portada y selección. */
const FLIGHT = 2.6;

export const TitleCamera: React.FC<{ mode: TitleMode; focusRef: React.MutableRefObject<Posicion3DPlano> }> = ({ mode, focusRef }) => {
  const { camera } = useThree();
  const sel = useMemo(selectPose, []);
  const st = useRef({ time: 0, mode: null as TitleMode | null, blend: 1, lift: 0 });
  const from = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const want = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const look = useRef(new THREE.Vector3());
  const ctrl = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, rawDelta) => {
    // Tope al delta: tras una pestaña en segundo plano el primer frame trae segundos y saltaría de toma.
    const delta = Math.min(rawDelta, 0.1);
    const s = st.current;
    if (s.mode !== mode) {
      if (s.mode !== null) {
        from.pos.copy(camera.position);
        from.look.copy(look.current);
        s.blend = 0;
        s.lift = mode === 'select' ? Math.min(40, 6 + from.pos.distanceTo(sel.pos) * 0.12) : 12;
        // Al volver a la portada se reanuda desde la toma del prado, que arranca cerca del pedestal.
        if (mode === 'title') s.time = 0.6;
      }
      s.mode = mode;
    }

    let fade = 0;
    if (mode === 'title') {
      s.time += delta;
      const a = shotAt(s.time);
      shotPose(a.i, a.u, want.pos, want.look);
      fade = s.blend < 1 ? 0 : a.fade;
      titleFx.shot = a.i;
    } else {
      // Deriva lenta de la cámara de selección: da vida al plano sin distraer del personaje.
      const t = clock.elapsedTime;
      want.pos.copy(sel.pos);
      want.pos.x += Math.sin(t * 0.23) * 0.28;
      want.pos.y += Math.sin(t * 0.31) * 0.08;
      want.look.copy(sel.look);
    }

    if (s.blend < 1) {
      s.blend = Math.min(1, s.blend + delta / FLIGHT);
      const e = easeInOutCubic(s.blend);
      // Bézier cuadrática con el punto de control elevado: la cámara despega, cruza alta y se posa.
      ctrl.copy(from.pos).lerp(want.pos, 0.5);
      ctrl.y = Math.max(from.pos.y, want.pos.y) + s.lift;
      const k = 1 - e;
      camera.position.set(
        k * k * from.pos.x + 2 * k * e * ctrl.x + e * e * want.pos.x,
        k * k * from.pos.y + 2 * k * e * ctrl.y + e * e * want.pos.y,
        k * k * from.pos.z + 2 * k * e * ctrl.z + e * e * want.pos.z,
      );
      // La mirada llega antes que la posición: se "apunta" al destino y luego se vuela hacia él.
      look.current.copy(from.look).lerp(want.look, easeInOutCubic(Math.min(1, s.blend * 1.35)));
    } else {
      camera.position.copy(want.pos);
      look.current.copy(want.look);
    }
    camera.position.y = Math.max(camera.position.y, Math.max(solidY(camera.position.x, camera.position.z), WATER_Y) + 0.8);
    camera.lookAt(look.current);
    titleFx.fade = fade;
    titleFx.onFrame?.(fade, titleFx.shot);
    // En las tomas lejanas la mirada cae a 100 m: sombras y monstruos siguen al punto de mira.
    focusRef.current = { x: look.current.x, z: look.current.z };
    playerPos.x = look.current.x;
    playerPos.z = look.current.z;
  });
  return null;
};
