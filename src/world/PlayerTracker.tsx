// Publica la posición del jugador en el store del mundo cada frame.
//
// En el juego completo esto lo hacía de paso CaptureController, que además busca el salvaje más cercano
// y escucha las teclas de captura. El modo exploración no monta la captura, pero el minimapa, el cartel
// de zona y la brújula de coliseos sí necesitan saber dónde está el jugador — eso es lo único que hace
// este componente.
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { Posicion3DPlano } from '../engine/runtime/movimiento';
import { playerPos } from './wildStore';

export const PlayerTracker: React.FC<{ targetRef: React.MutableRefObject<Posicion3DPlano> }> = ({ targetRef }) => {
  useFrame(() => {
    playerPos.x = targetRef.current.x;
    playerPos.z = targetRef.current.z;
  });
  return null;
};
