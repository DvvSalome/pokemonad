import React, { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { zoneName, ZONE_COLOR } from '../Minimap';
import { placeAt } from '../../world/terrain';
import { PEDESTAL } from '../../world/TitleCamera';
import { ENTRY_SECONDS } from '../../world/CameraRig';
import './intro.css';

/** Cuánto sigue oculto el cartel pequeño de zona del HUD tras aparecer el HUD (dura 3.6 s en HUD.tsx). */
const HUD_BANNER_MS = 3800;

/**
 * Entrada al mundo: franjas de cine mientras la cámara barre desde el pedestal hasta la pose de juego
 * (CameraRig) y un rótulo grande con el nombre de la zona. Avisa con `onHud` cuando el barrido termina para
 * que el HUD aparezca entonces y no encima del plano.
 */
export const EntryCinematic: React.FC<{ onHud: () => void }> = ({ onHud }) => {
  const t = useT();
  const [phase, setPhase] = useState<'in' | 'out' | 'done'>('in');
  const zone = placeAt(PEDESTAL.x, PEDESTAL.z) ?? 'meadow';

  useEffect(() => {
    const ms = ENTRY_SECONDS * 1000;
    const b = document.body;
    b.classList.add('pg-entering');
    const timers = [
      setTimeout(() => setPhase('out'), ms - 500),
      setTimeout(() => { onHud(); b.classList.add('pg-hud-in'); }, ms - 150),
      setTimeout(() => { setPhase('done'); b.classList.remove('pg-hud-in'); }, ms + 900),
      setTimeout(() => b.classList.remove('pg-entering'), ms + HUD_BANNER_MS),
    ];
    return () => { timers.forEach(clearTimeout); b.classList.remove('pg-entering', 'pg-hud-in'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'done') return null;
  return (
    <div className={`pg-entry ${phase}`} style={{ ['--zc' as string]: ZONE_COLOR[zone] ?? '#7fd35b' }} aria-live="polite">
      <div className="pg-entry-bar top" />
      <div className="pg-entry-bar bot" />
      <div className="pg-entry-card">
        <small>{t('entry.eyebrow')}</small>
        <h2><i />{zoneName(zone)}<i /></h2>
        <span>{t('entry.sub')}</span>
      </div>
    </div>
  );
};
