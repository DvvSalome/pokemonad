// La interfaz del modo exploración: brújula de la región arriba a la derecha y el elenco abajo.
import React, { useEffect, useRef, useState } from 'react';
import { Minimap, RegionMap, useZone, zoneName, ZONE_COLOR } from './Minimap';
import { CHARACTER_ROSTER, type RosterEntry } from '../engine/avatar/characterRoster';
import { useRunLock, setRunLock } from '../engine/avatar/useAvatarControls';
import { useAcademy } from '../academy/academyStore';
import { LangSwitch } from './LangSwitch';
import { CatchPrompt, FieldShop } from './FieldPlay';
import { t, useT } from '../i18n';
import './explore.css';

/** Cartel "entrando en…" al cambiar de bioma, igual que en el juego completo. */
const ZoneBanner: React.FC<{ zone: string }> = ({ zone }) => {
  useT();
  const [shown, setShown] = useState<string | null>(zone);
  useEffect(() => {
    setShown(zone);
    const id = setTimeout(() => setShown(null), 3600);
    return () => clearTimeout(id);
  }, [zone]);
  if (!shown) return null;
  return (
    <div className="ex-zone" key={shown} style={{ ['--ex-amber' as string]: ZONE_COLOR[shown] }}>
      <small>{t('zone.nowEntering')}</small>
      <b>{zoneName(shown)}</b>
    </div>
  );
};

/**
 * Los cuatro jugables. El cambio es en caliente — el avatar se recarga en el sitio donde estés, sin
 * pantalla de selección ni volver a entrar al mundo.
 */
const CharacterPicker: React.FC<{ character: RosterEntry; onPick: (c: RosterEntry) => void }> = ({ character, onPick }) => {
  const running = useRunLock();
  const tr = useT();
  return (
    <div className="ex-cast">
      {CHARACTER_ROSTER.map((c) => (
        <button
          key={c.id}
          className={`ex-char${c.id === character.id ? ' on' : ''}`}
          onClick={() => onPick(c)}
          title={`${c.nombre} — ${c.blurb}`}
        >
          <i>{c.emoji}</i>
          <b>{c.nombre}</b>
        </button>
      ))}
      <button
        className={`ex-run${running ? ' on' : ''}`}
        onClick={() => setRunLock(!running)}
        title={tr('hud.alwaysRunTitle')}
      >
        <b>{running ? tr('run.on') : tr('run.label')}</b>
        <small>{tr('run.hint')}</small>
      </button>
    </div>
  );
};

const KeyHint: React.FC = () => {
  const tr = useT();
  const [show, setShow] = useState(true);
  useEffect(() => { const id = setTimeout(() => setShow(false), 12000); return () => clearTimeout(id); }, []);
  if (!show) return null;
  return (
    <div className="ex-keys">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {tr('keys.move')}</span>
      <span><kbd>Shift</kbd> {tr('keys.run')}</span>
      <span>{tr('keys.look')}</span>
      <span><kbd>M</kbd> {tr('keys.map')}</span>
    </div>
  );
};

export const ExploreHUD: React.FC<{ character: RosterEntry; onCharacter: (c: RosterEntry) => void }> = ({ character, onCharacter }) => {
  const zone = useZone();
  const academy = useAcademy();
  const [map, setMap] = useState(false);
  const mapRef = useRef(false);
  mapRef.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'm' || e.key === 'M') setMap((v) => !v);
      else if (e.key === 'Escape' && mapRef.current) setMap(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Dentro del Coliseo Monad manda su interfaz: el HUD de exploración estorbaría encima.
  if (academy.phase !== 'closed') return null;

  return (
    <>
      <div className="ex-lang"><LangSwitch /></div>
      <ZoneBanner zone={zone} />
      <KeyHint />
      <CharacterPicker character={character} onPick={onCharacter} />
      <FieldShop />
      <CatchPrompt />
      <Minimap zone={zone} onOpen={() => setMap(true)} />
      {map && <RegionMap zone={zone} onClose={() => setMap(false)} />}
    </>
  );
};
