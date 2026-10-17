// El trainer: input (teclado + joystick táctil) → resolverMovimientoConDeslizamiento contra el terreno
// abierto (walkable/standY de terrain.ts) → GLTFAvatar. Reemplaza el Player3D de cowork-v3 (que
// colisionaba contra escritorios de oficina) por uno que camina sobre el heightfield de la región.
import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFAvatar } from '../engine/avatar/GLTFAvatar';
import { useRosterAvatar } from '../engine/avatar/useAvatar3D';
import { useAvatarControls, runLock } from '../engine/avatar/useAvatarControls';
import { resolverMovimientoConDeslizamiento, type Posicion3DPlano } from '../engine/runtime/movimiento';
import type { JoystickInput } from '../engine/scene/MobileJoystick';
import type { Avatar3DConfig } from '../engine/avatar/shared';
import { walkable, standY, arenaY } from './terrain';
import { isEncounterActive } from './captureStore';
import { inArena } from './battleStore';
import { SPOT, facing } from './arenaLayout';
import { orbit, forwardFromYaw, rightFromYaw } from './cameraStore';
import { takeWarp } from './wildStore';

// Algo más rápidas que el original (js/player.js: WALK 3.6, RUN 6.8): la región es grande para ir a pie.
const MOVE_SPEED = 4;
const RUN_SPEED = 8.2;

export interface PlayerProps {
  start?: Posicion3DPlano;
  /** Ref compartida con quien la necesite leer (la cámara que sigue al jugador). Player la posee y escribe. */
  posRef: React.MutableRefObject<Posicion3DPlano>;
  joystickRef: React.MutableRefObject<JoystickInput>;
  /** El personaje elegido en la pantalla de selección — pisa el avatar de Supabase cuando está presente. */
  characterConfig?: Avatar3DConfig;
}

export const Player: React.FC<PlayerProps> = ({ start = { x: 0, z: 9 }, posRef, joystickRef, characterConfig }) => {
  const groupRef = useRef<THREE.Group>(null);
  const avatarConfig = useRosterAvatar(characterConfig);
  const controls = useAvatarControls();
  // atan2(dx, dz) matches GLTFAvatar's rotation convention directly — see the comment on
  // facingAngleRef there for why this replaced the old 8-direction lookup table.
  const facingAngleRef = useRef(Math.PI);

  useFrame((_, delta) => {
    // Teletransporte desde el Dex ("Find it in…"): aplica antes de mover/congelar.
    const warp = takeWarp();
    if (warp) {
      posRef.current = { x: warp.x, z: warp.z };
      if (groupRef.current) {
        groupRef.current.position.set(warp.x, standY(warp.x, warp.z), warp.z);
      }
    }
    // En el estadio el entrenador se planta detrás de su monstruo, mirando al rival. posRef no se toca:
    // al volver, sigue donde empezó el encuentro.
    if (inArena()) {
      controls.updateMovement(0, 0);
      facingAngleRef.current = facing('player');
      groupRef.current?.position.set(SPOT.trainer.x, arenaY(), SPOT.trainer.z);
      return;
    }
    // Congelar al jugador durante un encuentro de captura: se queda quieto en idle.
    if (isEncounterActive()) {
      controls.updateMovement(0, 0);
      if (groupRef.current) {
        const y = standY(posRef.current.x, posRef.current.z);
        groupRef.current.position.set(posRef.current.x, y, posRef.current.z);
      }
      return;
    }
    // Ejes de INTENCIÓN (no de mundo): adelante/atrás y derecha/izquierda respecto a la pantalla.
    const keys = controls.keysPressed.current;
    let strafe = 0, fwd = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;

    const joy = joystickRef.current;
    if (joy.active && joy.magnitude > 0) { strafe += joy.dx; fwd += joy.dz; }

    // Movimiento RELATIVO A LA CÁMARA: W siempre empuja hacia el fondo de la pantalla, gire como gire la
    // vista. Es lo que hace el original y lo que vuelve usable una cámara que orbita — con movimiento
    // absoluto al mundo, girar la cámara dejaría los controles cruzados.
    const f = forwardFromYaw(orbit.yaw);
    const r = rightFromYaw(orbit.yaw);
    let ix = r.x * strafe + f.x * fwd;
    let iz = r.z * strafe + f.z * fwd;

    const mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; }

    const running = (controls.isRunningRef.current !== runLock.value) || joy.isRunning;
    const speed = (running ? RUN_SPEED : MOVE_SPEED) * delta;

    const resolved = resolverMovimientoConDeslizamiento({
      posicionActual: posRef.current,
      movimiento: { dx: ix * speed, dz: iz * speed },
      esPosicionValida: (x, z) => walkable(x, z),
    });

    posRef.current = resolved.posicion;
    const effIx = resolved.seMovio ? ix : 0;
    const effIz = resolved.seMovio ? iz : 0;
    controls.updateMovement(effIx, effIz, running);
    if (effIx !== 0 || effIz !== 0) {
      // El personaje encara hacia donde se mueve (en mundo), no hacia donde mira la cámara.
      facingAngleRef.current = Math.atan2(effIx, effIz);
    }

    if (groupRef.current) {
      const y = standY(posRef.current.x, posRef.current.z);
      groupRef.current.position.set(posRef.current.x, y, posRef.current.z);
    }
  });

  return (
    <group ref={groupRef} position={[start.x, standY(start.x, start.z), start.z]}>
      <GLTFAvatar avatarConfig={avatarConfig} animationState={controls.animationState} facingAngleRef={facingAngleRef} xray />
    </group>
  );
};
