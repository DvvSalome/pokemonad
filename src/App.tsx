import React, { useEffect, useState } from 'react';
import { Scene } from './Scene';
import { startArcSync, stopArcSync } from './world/arcSync';
import { LandingScreen } from './ui/LandingScreen';
import { CharacterSelectScreen } from './ui/CharacterSelectScreen';
import { HUD } from './ui/HUD';
import { CaptureOverlay } from './ui/CaptureOverlay';
import { CardReveal } from './ui/CardReveal';
import { BattleScreen } from './ui/BattleScreen';
import { RateLimitNotice } from './ui/RateLimitNotice';
import { EntryCinematic } from './ui/intro/EntryCinematic';
import { CHARACTER_ROSTER, type RosterEntry } from './engine/avatar/characterRoster';

type Screen = 'landing' | 'select' | 'playing';

// Un solo mundo 3D para las tres pantallas: la portada lo sobrevuela, la selección baja al pedestal del
// spawn y al jugar la cámara del juego toma el relevo desde ahí, sin recargar la región.
export const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('landing');
  const [character, setCharacter] = useState<RosterEntry>(CHARACTER_ROSTER[0]);
  // El HUD entra al terminar el barrido de cámara de la entrada (EntryCinematic), no encima del plano.
  const [hud, setHud] = useState(false);

  useEffect(() => {
    startArcSync();
    return stopArcSync;
  }, []);

  const mode = screen === 'landing' ? 'title' : screen === 'select' ? 'select' : 'play';
  return (
    <>
      <Scene mode={mode} characterConfig={character} />
      {screen === 'landing' && <LandingScreen onPlay={() => setScreen('select')} />}
      {screen === 'select' && (
        <CharacterSelectScreen
          selected={character}
          onChange={setCharacter}
          onBack={() => setScreen('landing')}
          onConfirm={() => { setHud(false); setScreen('playing'); }}
        />
      )}
      {screen === 'playing' && (
        <>
          <EntryCinematic onHud={() => setHud(true)} />
          {hud && <HUD character={character} />}
          <CaptureOverlay />
          <BattleScreen />
          <CardReveal />
          <RateLimitNotice />
        </>
      )}
    </>
  );
};
