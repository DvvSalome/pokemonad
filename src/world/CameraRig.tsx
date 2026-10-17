// Cámara orbital en tercera persona, calcada de research/pokegrass-source/js/camera.js: pose esférica
// alrededor del jugador (yaw/pitch/distancia de cameraStore, que el input mueve), con suavizado
// exponencial independiente del framerate y distinto para posición y punto de mira.
//
// Sin esquiva horizontal de árboles: el original tampoco la tiene. Lo resuelve dejando que el jugador
// gire la vista (ahora que la cámara orbita) y, en el original, con el fade de oclusores por shader — que
// acá está apagado porque su descarte por puntillado provocaba destellos al moverse (ver toon.ts).
import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Posicion3DPlano } from '../engine/runtime/movimiento';
import { standY, solidY } from './terrain';
import { orbit, camCtl } from './cameraStore';
import { inArena } from './battleStore';
import { easeInOutCubic } from './intro/shots';

/** Altura del punto de mira sobre el suelo del jugador: el pecho, no los pies. */
const LOOK_HEIGHT = 1.05;
/** Margen mínimo de la cámara sobre el terreno, al calcular la pose y después de suavizar. */
const FLOOR_MARGIN_POSE = 0.9;
const FLOOR_MARGIN_AFTER = 0.6;
/** Velocidades de suavizado: la mirada persigue un poco más rápido que la posición. */
const POS_LERP = 7;
const LOOK_LERP = 10;
/** Duración del barrido de cámara al entrar al mundo desde la selección (lo usa también el rótulo de zona). */
export const ENTRY_SECONDS = 3;

export const CameraRig: React.FC<{ targetRef: React.MutableRefObject<Posicion3DPlano>; ease?: boolean }> = ({ targetRef, ease = false }) => {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());
  // Punto de mira suavizado: se interpola aparte de la posición, que es lo que da la sensación de cámara
  // "con peso" del original en vez de una que se pega rígida al personaje.
  const lookNow = useRef(new THREE.Vector3());
  const started = useRef(false);
  // Barrido de entrada desde la pantalla de selección: pose esférica de partida y punto de mira de partida.
  const sweep = useRef<{ t: number; yaw: number; pitch: number; dist: number; look: THREE.Vector3 } | null>(null);

  useFrame((_, rawDelta) => {
    if (inArena()) return;
    const delta = Math.min(rawDelta, 0.1);
    const t = targetRef.current;
    const groundY = standY(t.x, t.z);

    desiredLook.current.set(t.x, groundY + LOOK_HEIGHT, t.z);

    // Pose esférica: la cámara vive en una esfera alrededor del punto de mira.
    const cp = Math.cos(orbit.pitch);
    let camX = desiredLook.current.x + Math.sin(orbit.yaw) * cp * orbit.distance;
    let camY = desiredLook.current.y + Math.sin(orbit.pitch) * orbit.distance;
    let camZ = desiredLook.current.z + Math.cos(orbit.yaw) * cp * orbit.distance;

    // Nunca por debajo del terreno: si el suelo sube entre el jugador y la cámara (el mundo es un cuenco
    // con volcán y montaña), la cámara se levanta en vez de meterse dentro de la ladera.
    camY = Math.max(camY, solidY(camX, camZ) + FLOOR_MARGIN_POSE);
    desired.current.set(camX, camY, camZ);

    if (!started.current && ease) {
      // Al venir de la pantalla de selección la cámara ya está colocada frente al pedestal: se guarda esa
      // pose en esféricas alrededor del jugador para barrer desde ahí hasta la pose de juego.
      started.current = true;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const off = camera.position.clone().sub(desiredLook.current);
      const dist = Math.max(2, off.length());
      sweep.current = {
        t: 0, dist,
        yaw: Math.atan2(off.x, off.z),
        pitch: Math.asin(THREE.MathUtils.clamp(off.y / dist, -0.2, 1.2)),
        look: camera.position.clone().addScaledVector(dir, camera.position.distanceTo(desiredLook.current)),
      };
      lookNow.current.copy(sweep.current.look);
    }
    const sw = sweep.current;
    if (sw && !camCtl.cut) {
      // Grúa en arco alrededor del jugador: abre hacia un lado y se aleja un poco más que la pose final antes
      // de posarse. El cabeceo extra es pequeño: con más, a mitad de barrido el plano se vuelve cenital.
      // Sigue a `desired` en vivo, así que moverse o girar la vista durante el barrido no provoca saltos.
      sw.t = Math.min(1, sw.t + delta / ENTRY_SECONDS);
      const e = easeInOutCubic(sw.t), arc = Math.sin(Math.PI * e);
      let dy = (orbit.yaw - sw.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
      const yaw = sw.yaw + dy * e + arc * 1.1;
      const pitch = THREE.MathUtils.lerp(sw.pitch, orbit.pitch, e) + arc * 0.12;
      const dist = THREE.MathUtils.lerp(sw.dist, orbit.distance, e) + arc * 6;
      const c = Math.cos(pitch);
      const x = desiredLook.current.x + Math.sin(yaw) * c * dist;
      const z = desiredLook.current.z + Math.cos(yaw) * c * dist;
      camera.position.set(x, Math.max(desiredLook.current.y + Math.sin(pitch) * dist, solidY(x, z) + FLOOR_MARGIN_POSE), z);
      lookNow.current.copy(sw.look).lerp(desiredLook.current, easeInOutCubic(Math.min(1, sw.t * 1.6)));
      if (sw.t >= 1) sweep.current = null;
    } else if (!started.current || camCtl.cut) {
      camCtl.cut = false;
      sweep.current = null;
      // Primer frame: colocar sin suavizar, si no la cámara "vuela" desde el origen al entrar al mundo.
      started.current = true;
      camera.position.copy(desired.current);
      lookNow.current.copy(desiredLook.current);
    } else {
      // Suavizado exponencial: mismo comportamiento a 30 o 144 fps.
      camera.position.lerp(desired.current, 1 - Math.exp(-delta * POS_LERP));
      lookNow.current.lerp(desiredLook.current, 1 - Math.exp(-delta * LOOK_LERP));
    }

    // Segundo clamp tras el suavizado: durante la interpolación la cámara puede rozar el suelo aunque la
    // pose objetivo estuviera por encima.
    camera.position.y = Math.max(
      camera.position.y,
      solidY(camera.position.x, camera.position.z) + FLOOR_MARGIN_AFTER,
    );

    camera.lookAt(lookNow.current);
  });

  return null;
};
