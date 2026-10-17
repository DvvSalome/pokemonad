// Arranca la presencia cuando hay sesión con el servidor (el id de presence es el del entrenador).
// No pinta nada: se monta en el HUD.
import React, { useEffect } from 'react';
import { useOnline } from './online';
import { sendPresencePos, startPresence, updatePresenceIdentity } from './presenceStore';
import { playerPos } from './wildStore';
import { inArena } from './battleStore';
import type { RosterEntry } from '../engine/avatar/characterRoster';

export const PresenceBoot: React.FC<{ character: Pick<RosterEntry, 'id' | 'nombre' | 'modelo_url'> }> = ({ character }) => {
  const { status, trainer } = useOnline();
  const id = status === 'online' ? trainer?.id : undefined;
  const name = trainer?.name ?? character.nombre;
  // Mandamos el id del roster: el otro lado saca de ahí el modelo y sus animaciones.
  const avatar = character.id || character.modelo_url;

  useEffect(() => {
    if (!id) return;
    return startPresence({ id, name, avatar });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { updatePresenceIdentity({ name, avatar }); }, [name, avatar]);

  // También manda la posición desde aquí, para que los demás te vean cerca aunque OtherPlayers no esté montado.
  useEffect(() => {
    if (!id) return;
    let prev = { x: playerPos.x, z: playerPos.z }, rot = Math.PI;
    const t = setInterval(() => {
      if (inArena()) return;
      const dx = playerPos.x - prev.x, dz = playerPos.z - prev.z;
      if (dx * dx + dz * dz > 1e-6) rot = Math.atan2(dx, dz);
      prev = { x: playerPos.x, z: playerPos.z };
      sendPresencePos(playerPos.x, playerPos.z, rot);
    }, 250);
    return () => clearInterval(t);
  }, [id]);

  return null;
};
