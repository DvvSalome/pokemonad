import React, { useEffect, useState } from 'react';
import { eventPlace, useEvents, useWild } from '../world/wildStore';
import { zoneName } from './Minimap';
import { useT } from '../i18n';
import { rich } from '../i18n/rich';
import './features.css';
import './polish/panels.css';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Aviso del Monstruo Dorado en curso (dónde está y cuánto le queda; solo el primero que lo atrapa se lo queda) o,
 * si no hay Dorado, del legendario del horario que espera en Legend Summit (holders o Summit Pass).
 */
export const EventBanner: React.FC<{ onOpenMap: () => void }> = ({ onOpenMap }) => {
  const events = useEvents();
  const wild = useWild();
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  const gold = events.find((e) => e.kind === 'golden' && e.endsAt > now);
  const legend = wild.spawns.find((sp) => sp.id.startsWith('legend-') && (sp.expiresAt ?? 0) > now);
  if (!gold && !legend) return null;
  if (!gold && legend) {
    return (
      <button className="pg-event-banner" onClick={onOpenMap} title={t('event.openMap')}>
        {rich(t('lg.banner', { name: legend.species.name, time: mmss(Math.max(0, Math.round(((legend.expiresAt ?? now) - now) / 1000))) }))}
      </button>
    );
  }
  const left = Math.max(0, Math.round((gold!.endsAt - now) / 1000));
  const place = zoneName(eventPlace(gold!));
  return (
    <button className="pg-event-banner" onClick={onOpenMap} title={t('event.openMap')}>
      {gold!.caughtBy
        ? rich(t('event.caught', { who: gold!.caughtBy }))
        : rich(t('event.appeared', { place, time: mmss(left) }))}
    </button>
  );
};
