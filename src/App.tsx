import React, { useState } from 'react';
import { Scene } from './Scene';
import { ExploreHUD } from './ui/ExploreHUD';
import { AcademyUI } from './academy/AcademyUI';
import { LectureCapture } from './ui/LectureCapture';
import { ProgressToasts } from './ui/PlayerHub';
import { CHARACTER_ROSTER, characterById, type RosterEntry } from './engine/avatar/characterRoster';

/**
 * Modo exploración: se entra directo al mundo.
 *
 * No hay portada ni cortinilla de entrada: al cargar ya estás de pie en la pradera. El personaje se
 * cambia en caliente desde el HUD (los cuatro del Animated Monster Pack) y la elección se recuerda,
 * así que tampoco hace falta una pantalla de selección para eso.
 */
const SAVED = 'pg-character';

function firstCharacter(): RosterEntry {
  try {
    const id = localStorage.getItem(SAVED);
    if (id) return characterById(id);
  } catch { /* sin storage: el primero del elenco */ }
  return CHARACTER_ROSTER[0];
}

export const App: React.FC = () => {
  const [character, setCharacter] = useState<RosterEntry>(firstCharacter);
  const choose = (next: RosterEntry) => {
    setCharacter(next);
    try { localStorage.setItem(SAVED, next.id); } catch { /* sin storage: solo esta partida */ }
  };
  return (
    <>
      <Scene mode="play" characterConfig={character} explore />
      <ExploreHUD character={character} onCharacter={choose} />
      <LectureCapture />
      <AcademyUI />
      {/* Siempre montado: la experiencia también salta en mitad de un combate del coliseo. */}
      <ProgressToasts />
    </>
  );
};
