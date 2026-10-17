// Los otros entrenadores conectados (presenceStore). Cada frame: manda la posición propia (sacada de
// playerPos, con la cara según hacia dónde se movió) y acerca cada remoto a su última posición recibida.
// Solo se montan los que están a menos de ~70 m; la lista cercana se recalcula 2 veces por segundo.
import React, { Suspense, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFAvatar } from '../engine/avatar/GLTFAvatar';
import { useRosterAvatar } from '../engine/avatar/useAvatar3D';
import { CHARACTER_ROSTER } from '../engine/avatar/characterRoster';
import type { AnimationState, Avatar3DConfig } from '../engine/avatar/shared';
import { standY } from './terrain';
import { inArena } from './battleStore';
import { playerPos } from './wildStore';
import { isRemoteMoving, livePositions, sendPresencePos, usePresence, type RemotePlayer } from './presenceStore';
import '../ui/presence.css';

const RANGE = 70;
/** Margen para que alguien justo en el borde no aparezca y desaparezca. */
const RANGE_OUT = 76;
const LABEL_Y = 1.95;

/** El avatar llega como id del roster o como URL de un modelo. */
function avatarConfigOf(avatar: string): Avatar3DConfig {
  const r = CHARACTER_ROSTER.find((c) => c.id === avatar || c.modelo_url === avatar);
  if (r) return r;
  if (/^(https?:)?\//.test(avatar)) return { id: `url-${avatar}`, nombre: 'Trainer', modelo_url: avatar, escala: 1 };
  return CHARACTER_ROSTER[0];
}

const Remote: React.FC<{ p: RemotePlayer }> = ({ p }) => {
  const groupRef = useRef<THREE.Group>(null);
  const cfg = useMemo(() => avatarConfigOf(p.avatar), [p.avatar]);
  const avatarConfig = useRosterAvatar(cfg);
  const facingAngleRef = useRef(p.rot);
  const cur = useRef<{ x: number; z: number } | null>(null);
  const [anim, setAnim] = useState<AnimationState>('idle');
  const animRef = useRef<AnimationState>('idle');
  const [labelY, setLabelY] = useState(LABEL_Y);

  useFrame((_, delta) => {
    const live = livePositions.get(p.id);
    if (!live || !groupRef.current) return;
    if (!cur.current) cur.current = { x: live.x, z: live.z };
    const c = cur.current;
    const dx = live.x - c.x, dz = live.z - c.z;
    const d = Math.hypot(dx, dz);
    // Si se teletransportó (o volvió de lejos) saltamos; si no, lerp suave hacia el último dato.
    if (d > 12) { c.x = live.x; c.z = live.z; }
    else { const k = 1 - Math.exp(-delta * 8); c.x += dx * k; c.z += dz * k; }
    facingAngleRef.current = live.rot;
    groupRef.current.position.set(c.x, standY(c.x, c.z), c.z);

    const moving = d > 0.05 || (isRemoteMoving(p.id) && Date.now() - live.t < 600);
    const next: AnimationState = d > 0.6 ? 'run' : moving ? 'walk' : 'idle';
    if (next !== animRef.current) { animRef.current = next; setAnim(next); }
  });

  const live = livePositions.get(p.id);
  const x0 = live?.x ?? p.x, z0 = live?.z ?? p.z;
  return (
    <group ref={groupRef} position={[x0, standY(x0, z0), z0]}>
      <Suspense fallback={null}>
        <GLTFAvatar
          avatarConfig={avatarConfig}
          animationState={anim}
          facingAngleRef={facingAngleRef}
          assetQuality="medium"
          onHeightComputed={(h) => setLabelY(h + 0.25)}
        />
      </Suspense>
      <Html position={[0, labelY, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className="pg-presence-tag">{p.name}</div>
      </Html>
    </group>
  );
};

export const OtherPlayers: React.FC<{ posRef?: React.MutableRefObject<{ x: number; z: number }> }> = ({ posRef }) => {
  const { players } = usePresence();
  const [near, setNear] = useState<string[]>([]);
  const nearRef = useRef<string[]>([]);
  const prev = useRef<{ x: number; z: number } | null>(null);
  const rot = useRef(Math.PI);
  const acc = useRef(0);

  useFrame((_, delta) => {
    const me = posRef?.current ?? playerPos;
    // En el estadio la posición del jugador es la del combate: no la mandamos al mapa.
    if (!inArena()) {
      const pv = prev.current;
      if (pv) {
        const dx = me.x - pv.x, dz = me.z - pv.z;
        if (dx * dx + dz * dz > 1e-6) rot.current = Math.atan2(dx, dz);
      }
      prev.current = { x: me.x, z: me.z };
      sendPresencePos(me.x, me.z, rot.current);
    }

    acc.current += delta;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const was = new Set(nearRef.current);
    const next = players.filter((p) => {
      const l = livePositions.get(p.id);
      if (!l) return false;
      const d = Math.hypot(l.x - me.x, l.z - me.z);
      return d < (was.has(p.id) ? RANGE_OUT : RANGE);
    }).map((p) => p.id);
    if (next.length !== nearRef.current.length || next.some((id, i) => id !== nearRef.current[i])) {
      nearRef.current = next;
      setNear(next);
    }
  });

  const shown = useMemo(() => {
    const ids = new Set(near);
    return players.filter((p) => ids.has(p.id));
  }, [players, near]);

  return <>{shown.map((p) => <Remote key={p.id} p={p} />)}</>;
};
