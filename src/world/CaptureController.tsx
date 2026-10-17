// Enlaza al jugador con la captura: cada frame busca el monstruo salvaje más cercano y lo marca como
// "cercano" (para el prompt de la HUD); y escucha el teclado — E inicia el encuentro con el cercano,
// Espacio/Enter lanza la bola, Esc huye. El ratón (botones de la UI) hace lo mismo desde el overlay.
import React, { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Posicion3DPlano } from '../engine/runtime/movimiento';
import { getSpawns, playerPos } from './wildStore';
import {
  setNearby, startEncounter, throwBall, runAway,
  getNearbyId, getActiveId, getCaught, getPhase,
} from './captureStore';
import { isBattleActive } from './battleStore';

/** Radio, en metros, al que se puede iniciar un encuentro con un monstruo. */
const REACH = 3.6;

export const CaptureController: React.FC<{ targetRef: React.MutableRefObject<Posicion3DPlano> }> = ({ targetRef }) => {
  useFrame(() => {
    const p = targetRef.current;
    playerPos.x = p.x; playerPos.z = p.z;
    if (getActiveId()) return; // en encuentro: no recalcular cercanía
    const caught = getCaught();
    let best: string | null = null;
    let bestD = REACH * REACH;
    for (const s of getSpawns()) {
      if (caught.has(s.id)) continue;
      const dx = s.x - p.x, dz = s.z - p.z, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = s.id; }
    }
    setNearby(best);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isBattleActive()) return; // el combate tiene sus propias teclas (BattleScreen)
      if (getActiveId()) {
        if (e.code === 'Space' || e.code === 'Enter') {
          if (getPhase() === 'aim') { e.preventDefault(); throwBall(); }
        } else if (e.code === 'Escape') {
          runAway();
        }
        return;
      }
      if (e.code === 'KeyE') {
        const near = getNearbyId();
        if (near) { e.preventDefault(); startEncounter(near); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
};
