import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { heightAt } from '../terrain';
import { flatLight } from '../lighting';
import type { Posicion3DPlano } from '../../engine/runtime/movimiento';
import { WIND } from './wind';
import { LIFE, LIFE_UNIFORMS, nightAt } from './lifeState';
import { Footsteps } from './Footsteps';
import { AirMotes } from './AirMotes';
import { Butterflies } from './Butterflies';
import { BirdFlock } from './BirdFlock';

// Capa de vida del mundo: mantiene el viento y el estado compartido (jugador, hora) y monta los
// sistemas de ambiente. Cada sistema es una sola llamada de dibujo animada en GPU.

interface Props {
  /** Posición del jugador (o del personaje del pedestal en la pantalla de título). */
  playerRef: React.MutableRefObject<Posicion3DPlano>;
}

export const LivingWorld: React.FC<Props> = ({ playerRef }) => {
  const st = useRef({ lastX: NaN, lastZ: NaN, clockT: 0, nextHour: 0 });

  useFrame(({ clock }, delta) => {
    const s = st.current;
    const t = clock.elapsedTime;
    WIND.uLifeT.value = t;
    // El viento rola muy despacio: en una sesión larga las ráfagas no vienen siempre del mismo lado.
    const ang = 0.52 + Math.sin(t * 0.011) * 0.4;
    WIND.uWindDir.value.set(Math.cos(ang), Math.sin(ang));

    const p = playerRef.current;
    const y = heightAt(p.x, p.z);
    LIFE.player.set(p.x, y, p.z);
    WIND.uPlayer.value.set(p.x, y, p.z, 1);

    const dt = Math.max(delta, 1e-3);
    if (Number.isFinite(s.lastX)) {
      const dx = p.x - s.lastX, dz = p.z - s.lastZ;
      const d = Math.hypot(dx, dz);
      // Un salto grande es un teletransporte (arena, reaparición), no una carrera.
      const v = d / dt > 20 ? 0 : d / dt;
      LIFE.speed += (v - LIFE.speed) * Math.min(1, dt * 10);
      if (d > 1e-4) LIFE.heading.set(dx / d, dz / d);
    }
    s.lastX = p.x; s.lastZ = p.z;

    if (t >= s.nextHour) {
      s.nextHour = t + 1;
      LIFE.night = nightAt(new Date());
    }
    LIFE_UNIFORMS.uNight.value += (LIFE.night - LIFE_UNIFORMS.uNight.value) * Math.min(1, dt * 2);
    flatLight(LIFE_UNIFORMS.uLight.value);
  });

  return (
    <>
      <Footsteps />
      <AirMotes />
      <Butterflies />
      <BirdFlock />
    </>
  );
};
