// El pedestal de la pantalla de selección: una peana de piedra con anillo dorado sobre el spawn y, encima,
// el personaje elegido en idle. El giro por defecto es un vaivén suave de cara a la cámara; arrastrando
// (el overlay escribe en `turntable`) gira libre con inercia y al soltar vuelve despacio a mirar al frente.
//
// El acento de luz es falso a propósito (columna aditiva, charco de luz y chispas): añadir una luz real a
// mitad de partida cambia el número de luces y obliga a recompilar todos los shaders de la escena (tirón).
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFAvatar } from '../engine/avatar/GLTFAvatar';
import type { Avatar3DConfig } from '../engine/avatar/shared';
import { useRosterAvatar } from '../engine/avatar/useAvatar3D';
import { standY } from './terrain';
import { PEDESTAL, selectPose } from './TitleCamera';

export const turntable = { angle: 0, dragging: false, velocity: 0, touched: 0 };
const TOP = 0.34;

/** Degradado vertical (opaco abajo → transparente arriba) para la columna de luz. */
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Disco radial suave para el charco de luz en el suelo y la onda de cambio de personaje. */
function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const Pedestal: React.FC<{ character: Avatar3DConfig }> = ({ character }) => {
  const avatar = useRosterAvatar(character);
  const gy = standY(PEDESTAL.x, PEDESTAL.z);
  // De frente a la cámara de selección (el avatar mira hacia +Z con ángulo 0).
  const front = useMemo(() => {
    const p = selectPose().pos;
    return Math.atan2(p.x - PEDESTAL.x, p.z - PEDESTAL.z);
  }, []);
  const facing = useRef(front);
  const ring = useRef<THREE.Mesh>(null);
  const wave = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  const pop = useRef(1);
  const tex = useMemo(() => ({ beam: beamTexture(), pool: poolTexture() }), []);
  useEffect(() => () => { tex.beam.dispose(); tex.pool.dispose(); }, [tex]);
  useEffect(() => { turntable.angle = front; turntable.velocity = 0; }, [front]);
  useEffect(() => { pop.current = 0; }, [character.id]);

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const t = clock.elapsedTime;
    if (!turntable.dragging) {
      turntable.velocity *= Math.exp(-delta * 2.5);
      turntable.angle += turntable.velocity * delta;
      // Pasado un momento sin tocarlo, vuelve por el camino corto al vaivén frontal.
      if (Math.abs(turntable.velocity) < 0.4 && t - turntable.touched > 1.2) {
        const rest = front + Math.sin(t * 0.5) * 0.38;
        let d = (rest - turntable.angle) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
        turntable.angle += d * (1 - Math.exp(-delta * 1.6));
      }
    } else turntable.touched = t;
    facing.current = turntable.angle;

    // Entrada del personaje: escala con rebote corto y una onda dorada que se abre en el suelo.
    pop.current = Math.min(1, pop.current + delta / 0.55);
    const p = pop.current;
    const q = p - 1, s = 0.6 + 0.4 * (1 + 2.70158 * q * q * q + 1.70158 * q * q);
    body.current?.scale.set(s, s, s);
    if (wave.current) {
      const w = 1 + p * 1.6;
      wave.current.scale.set(w, w, 1);
      (wave.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.75;
      wave.current.visible = p < 1;
    }
    if (ring.current) {
      const r = 1 + Math.sin(t * 2.2) * 0.03;
      ring.current.scale.set(r, r, 1);
    }
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.07 + Math.sin(t * 1.3) * 0.015;
  });

  return (
    <group position={[PEDESTAL.x, gy, PEDESTAL.z]}>
      <mesh position={[0, TOP * 0.5 - 0.06, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.18, 1.32, TOP + 0.12, 40]} />
        <meshLambertMaterial color="#cfc6b3" />
      </mesh>
      <mesh position={[0, TOP + 0.005, 0]} receiveShadow>
        <cylinderGeometry args={[1.08, 1.08, 0.02, 40]} />
        <meshLambertMaterial color="#5f93e0" />
      </mesh>
      <mesh ref={ring} position={[0, TOP + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.2, 48]} />
        <meshBasicMaterial color="#ffd84a" toneMapped={false} />
      </mesh>
      <mesh ref={wave} position={[0, TOP + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[1.05, 1.22, 48]} />
        <meshBasicMaterial color="#fff2a8" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.6, 4.6]} />
        <meshBasicMaterial map={tex.pool} color="#ffe27a" transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={beam} position={[0, TOP + 1.8, 0]} renderOrder={2}>
        <cylinderGeometry args={[0.9, 1.1, 3.6, 32, 1, true]} />
        <meshBasicMaterial map={tex.beam} color="#fff0b0" transparent opacity={0.07} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <Sparkles count={26} scale={[2.2, 2.6, 2.2]} position={[0, TOP + 1.4, 0]} size={2.6} speed={0.35} opacity={0.8} color="#ffe98a" noise={0.6} />
      <group ref={body} position={[0, TOP + 0.02, 0]}>
        <GLTFAvatar key={character.id} avatarConfig={avatar} animationState="idle" facingAngleRef={facing} />
      </group>
    </group>
  );
};
