// El overlay DOM del encuentro, portado de research/pokegrass-source/js/capture.js (placa del monstruo,
// aro que encoge, selector de bola, Throw/Run, veredicto). Se dibuja sobre el canvas. El aro sigue al
// monstruo proyectando su posición a pantalla (live.screen), que Monsters.tsx actualiza cada frame; aquí
// un rAF lo copia al DOM sin provocar re-render de React. Adaptado a la cámara de seguimiento: sin el
// barrido cinematográfico del original, el aro se dibuja directamente encima del monstruo salvaje.
import React, { useEffect, useRef } from 'react';
import { BALLS, BALL_ORDER, TYPE_COLORS } from '../world/species';
import {
  useCapture, live, selectBall, throwBall, runAway, endEncounter, displayChance,
} from '../world/captureStore';
import { startBattle, defaultFighterId, useBattle } from '../world/battleStore';
import { spawnById as spawnOf, useWild } from '../world/wildStore';
import { fmtUsd } from '../world/tokenSpecies';
import { useT } from '../i18n';
import './captureFx.css';

export const CaptureOverlay: React.FC = () => {
  const cap = useCapture();
  const battle = useBattle();
  const t = useT();
  useWild();
  const ringRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);

  // Seguir al monstruo en pantalla con rAF (sin re-render): posiciona el aro y el marcador de objetivo.
  useEffect(() => {
    if (!cap.activeId) return;
    let raf = 0;
    const tick = () => {
      const s = live.screen;
      const ring = ringRef.current, mark = markRef.current, fx = fxRef.current;
      if (fx) { fx.style.setProperty('--x', `${s.x}px`); fx.style.setProperty('--y', `${s.y}px`); }
      if (ring && mark) {
        const on = s.visible;
        ring.style.opacity = on && cap.phase === 'aim' ? '1' : '0';
        mark.style.opacity = on && cap.phase === 'aim' ? '1' : '0';
        const ringSize = Math.max(46, s.size * (0.35 + live.ringK * 1.15));
        ring.style.left = mark.style.left = `${s.x}px`;
        ring.style.top = mark.style.top = `${s.y}px`;
        ring.style.width = ring.style.height = `${ringSize}px`;
        const markSize = Math.max(40, s.size);
        mark.style.width = mark.style.height = `${markSize}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cap.activeId, cap.phase]);

  if (!cap.activeId || battle.active) return null;
  const spawn = spawnOf(cap.activeId);
  if (!spawn) return null;
  const sp = spawn.species;
  const busy = cap.phase !== 'aim';
  // El resultado 'caught' lo celebra el revelado de carta (CardReveal); aquí solo mostramos el panel de
  // veredicto cuando huye o cuando (raro) hay otro resultado sin carta.
  const done = cap.result !== null && cap.result !== 'caught';
  const fighterId = cap.collection.length ? defaultFighterId() : null;

  return (
    <div className="pg-cap">
      {/* Realce de pantalla de la animación (destellos, rayos, viñeta de tensión) */}
      <div ref={fxRef} className={`pg-capfx p-${cap.phase}`}>
        <i key={`fl-${cap.phase}`} className="fl" />
        <i key={`ry-${cap.phase}`} className="rays" />
        <i className="vig" />
      </div>
      {/* Marcador de objetivo y aro que sigue al monstruo */}
      <div ref={markRef} className="pg-cap-mark" />
      <div ref={ringRef} className={`pg-cap-ring q-${cap.qualityLabel ? 'hit' : 'idle'}`}>
        <span className="pg-cap-ring-i" />
      </div>

      {/* Placa del monstruo (arriba) */}
      <div className="pg-cap-plate pg-glass">
        <div className="pg-cap-name">{sp.name}{cap.shiny && <span className="pg-cap-shiny">{t('cap.shiny')}</span>}</div>
        <div className="pg-cap-tags">
          <span className="pg-chip" style={{ background: TYPE_COLORS[sp.type] }}>{sp.type}</span>
          <span className={`pg-rar t-${sp.tier}`}>{sp.tier}</span>
        </div>
        {spawn.token && (
          <div className="pg-cap-token" title={spawn.token.address}>
            <b>${spawn.token.symbol}</b> · mcap {fmtUsd(spawn.token.marketCap)} · {t('cap.stage', { n: spawn.stage ?? 1 })}
          </div>
        )}
        {cap.foeMax > 0 && cap.foeHp < cap.foeMax && (
          <div className="pg-cap-foehp" title={t('cap.weakened')}>
            <span style={{ width: `${Math.max(0, (100 * cap.foeHp) / cap.foeMax)}%` }} />
          </div>
        )}
      </div>

      {/* Mensaje del narrador */}
      {cap.message && <div className="pg-cap-say pg-glass">{cap.message}</div>}
      {cap.qualityLabel && cap.phase !== 'aim' && !done && (
        <div className="pg-cap-q pop">{cap.qualityLabel}</div>
      )}

      {/* Veredicto final */}
      {done ? (
        <div className="pg-cap-verdict pg-panel">
          <div className={`pg-cap-verdict-icon ${cap.result}`}>{cap.result === 'caught' ? '✓' : '…'}</div>
          <div className="pg-cap-verdict-msg">{cap.message}</div>
          <button className={`pg-btn ${cap.result === 'caught' ? 'gold' : ''}`} onClick={endEncounter}>
            {t(cap.result === 'caught' ? 'cap.nice' : 'cap.continue')}
          </button>
        </div>
      ) : (
        /* Barra de control (abajo): selector de bola + Throw + Run */
        <div className="pg-cap-bar pg-panel">
          <div className="pg-cap-balls">
            {BALL_ORDER.map((k) => {
              const n = cap.balls[k];
              const hex = `#${BALLS[k].color.toString(16).padStart(6, '0')}`;
              return (
                <button
                  key={k}
                  className={`pg-cap-ball ${cap.ball === k ? 'on' : ''}`}
                  disabled={busy || n <= 0}
                  onClick={() => selectBall(k)}
                  title={BALLS[k].name}
                >
                  <span className="pg-ball-ico" style={{ ['--top' as string]: hex }} />
                  <span className="pg-cap-ball-n">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="pg-cap-actions">
            <button className="pg-btn gold" disabled={busy || cap.balls[cap.ball] <= 0} onClick={() => throwBall()}>
              {t('cap.throw')} <b>{displayChance()}%</b>
            </button>
            {fighterId && (
              <button className="pg-btn" disabled={busy} onClick={() => startBattle(fighterId)} title={t('cap.fightTitle')}>
                {t('cap.fight')}
              </button>
            )}
            <button className="pg-btn ghost small" disabled={busy} onClick={runAway}>{t('cap.run')}</button>
          </div>
        </div>
      )}
    </div>
  );
};
