import React, { useEffect, useRef, useState } from 'react';
import { CHARACTER_ROSTER, type RosterEntry } from '../engine/avatar/characterRoster';
import { portrait } from '../world/portrait';
import { turntable } from '../world/Pedestal';
import { tk, useT } from '../i18n';
import './intro/intro.css';

interface Props {
  selected: RosterEntry;
  onChange: (character: RosterEntry) => void;
  onBack: () => void;
  onConfirm: () => void;
}

/**
 * Elección de entrenador sobre el mundo: el personaje elegido está de pie en el pedestal del spawn (ver
 * Pedestal.tsx) y se gira arrastrando. Flechas o ←/→ para cambiar, Enter para entrar.
 */
export const CharacterSelectScreen: React.FC<Props> = ({ selected, onChange, onBack, onConfirm }) => {
  const t = useT();
  const idx = Math.max(0, CHARACTER_ROSTER.findIndex((c) => c.id === selected.id));
  const go = (d: number) => onChange(CHARACTER_ROSTER[(idx + d + CHARACTER_ROSTER.length) % CHARACTER_ROSTER.length]);
  const last = useRef<number | null>(null);
  // Salida con animación corta (el panel se va y la cámara arranca) antes de cambiar de pantalla.
  const [leaving, setLeaving] = useState<null | 'play' | 'back'>(null);
  const leave = (to: 'play' | 'back') => {
    if (leaving) return;
    setLeaving(to);
    setTimeout(to === 'play' ? onConfirm : onBack, to === 'play' ? 420 : 260);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (leaving) return;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') go(-1);
      else if (e.key === 'Enter') leave('play');
      else if (e.key === 'Escape') leave('back');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    turntable.dragging = true;
    last.current = e.clientX;
  };
  const onMove = (e: React.PointerEvent) => {
    if (last.current === null) return;
    const dx = e.clientX - last.current;
    last.current = e.clientX;
    turntable.angle += dx * 0.012;
    turntable.velocity = dx * 0.6;
  };
  const onUp = () => { turntable.dragging = false; last.current = null; };

  return (
    <div className={`pg-select${leaving ? ` is-leaving to-${leaving}` : ''}`}>
      <div className="pg-select-shade" />
      <div className="pg-select-drag" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />

      <button className="pg-gbtn back" onClick={() => leave('back')}><span className="ico">◀</span>{t('select.back')}</button>
      <div className="pg-select-hint">{t('select.drag')}</div>

      <section className="pg-select-panel">
        <span className="pg-select-eyebrow">{t('select.eyebrow', { n: idx + 1, total: CHARACTER_ROSTER.length })}</span>
        <div className="pg-select-name">
          <button className="pg-arrow" onClick={() => go(-1)} aria-label={t('select.prev')}>‹</button>
          <h1 key={selected.id}>{selected.nombre}</h1>
          <button className="pg-arrow" onClick={() => go(1)} aria-label={t('select.next')}>›</button>
        </div>
        <p className="pg-select-blurb">{tk(`roster.${selected.id}`, selected.blurb)}</p>

        <div className="pg-roster">
          {CHARACTER_ROSTER.map((c, i) => (
            <Portrait key={c.id} c={c} i={i} on={c.id === selected.id} onClick={() => onChange(c)} />
          ))}
        </div>

        <button className="pg-play wide" onClick={() => leave('play')}>
          <span className="pg-play-ball" aria-hidden />
          <span className="pg-play-txt">{t('select.playAs', { name: selected.nombre.toUpperCase() })}</span>
        </button>
        <div className="pg-select-keys">
          <span><kbd>←</kbd><kbd>→</kbd> {t('select.keys')}</span>
          <span><kbd>Enter</kbd> {t('select.enter')}</span>
        </div>
      </section>
      <div className="pg-select-flash" />

      {/* Atribución CC-BY: debe permanecer visible para el jugador (ver PROJECT_CONTEXT.md). */}
      <p className="pg-credit">
        {t('select.credit')}
      </p>
    </div>
  );
};

const Portrait: React.FC<{ c: RosterEntry; i: number; on: boolean; onClick: () => void }> = ({ c, i, on, onClick }) => {
  const [img, setImg] = useState<string>('');
  useEffect(() => {
    let alive = true;
    portrait(c.modelo_url, { bust: true }).then((u) => alive && setImg(u));
    return () => { alive = false; };
  }, [c.modelo_url]);
  return (
    <button className={`pg-portrait${on ? ' on' : ''}`} onClick={onClick} title={c.nombre} style={{ ['--i' as string]: i }}>
      {img ? <img src={img} alt="" /> : <span className="emo">{c.emoji}</span>}
      <span className="nm">{c.nombre}</span>
    </button>
  );
};
