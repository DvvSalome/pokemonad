import React, { useEffect, useRef, useState } from 'react';
import { SPECIES_CATALOG } from '../world/species';
import { SHOTS, titleFx } from '../world/intro/shots';
import { useWild } from '../world/wildStore';
import { fetchBoard } from '../world/online';
import type { BoardResult, FeedRow } from '../../lib/api';
import { imgUrl } from '../world/tokenLook';
import { useT } from '../i18n';
import { LangSwitch } from './LangSwitch';
import './intro/intro.css';

interface Props { onPlay: () => void }
/** Lo que tarda el revelado escalonado del título (coincide con los retardos de game.css). */
const REVEAL_MS = 2600;

/**
 * Pantalla de título: el mundo 3D real sobrevolado de fondo (Scene en modo 'title'), el logo grande, el
 * botón de jugar tipo consola, contadores en vivo del servidor y un ticker con las últimas capturas.
 */
export const LandingScreen: React.FC<Props> = ({ onPlay }) => {
  const wild = useWild();
  const t = useT();
  const [board, setBoard] = useState<BoardResult | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetchBoard().then((b) => alive && setBoard(b)).catch(() => {});
    load();
    const iv = setInterval(load, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Revelado del título: los elementos entran escalonados por CSS; cualquier tecla o clic lo completa de golpe.
  const [ready, setReady] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [booted, setBooted] = useState(false);
  const [shot, setShot] = useState(0);
  const fadeEl = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const finish = (bySkip: boolean) => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
    if (bySkip) setSkipped(true);
  };
  useEffect(() => {
    if (!booted) return;
    const iv = setTimeout(() => finish(false), REVEAL_MS);
    return () => clearTimeout(iv);
  }, [booted]);
  useEffect(() => {
    let cur = -1, first = true;
    titleFx.onFrame = (fade, i) => {
      if (fadeEl.current) fadeEl.current.style.opacity = String(fade);
      if (first) { first = false; setBooted(true); }
      if (i !== cur) { cur = i; setShot(i); }
    };
    return () => { titleFx.onFrame = null; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(); }
      else finish(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPlay]);

  const inGrass = wild.spawns.filter((s) => s.kind !== 'lure' && s.kind !== 'safari').length;
  const top = board?.week[0] ?? board?.allTime[0];
  const feed = board?.feed ?? [];

  return (
    <div className={`pg-title${booted ? ' is-booted' : ''}${ready ? ' is-ready' : ''}${skipped ? ' is-skip' : ''}`} onPointerDown={() => finish(true)}>
      <div className="pg-title-shade" />
      <div className="pg-shotfade" ref={fadeEl} />
      <div className={`pg-boot${booted ? ' off' : ''}`}>
        <span className="pg-boot-ball" aria-hidden />
        <span>{t('title.booting')}</span>
      </div>

      <header className="pg-title-top">
        <span className="pg-live"><i />{t(wild.source === 'arc' ? 'title.live.arc' : wild.source === 'loading' ? 'title.live.loading' : 'title.live.demo')}</span>
        <LangSwitch />
      </header>

      <main className="pg-title-main">
        <h1 className="pg-logo" aria-label="PokeScout">
          <LogoLine cls="l1" text="POKE" at={0} />
          <LogoLine cls="l2" text="SCOUT" at={4} />
        </h1>
        <div className="pg-logo-ribbon">MONAD EDITION</div>
        <p className="pg-title-tag">{t('title.tag')}</p>

        <button className="pg-play" onClick={onPlay}>
          <span className="pg-play-ball" aria-hidden />
          <span className="pg-play-txt">{t('title.play')}</span>
        </button>
        <div className="pg-press"><kbd>Enter</kbd> {t('title.toStart')}</div>

        <div className="pg-stats">
          <div className="pg-stat"><b>{inGrass || '—'}</b><span>{t('title.stat.grass')}</span></div>
          <div className="pg-stat"><b>{SPECIES_CATALOG.length}</b><span>{t('title.stat.species')}</span></div>
          <div className="pg-stat"><b>{top ? top.points : '—'}</b><span>{top ? t('title.stat.pts', { name: top.name }) : t('title.stat.top')}</span></div>
        </div>
      </main>

      <div className="pg-shotcap" key={shot}>
        <small>{t('intro.region')}</small>
        <b>{t(SHOTS[shot].label)}</b>
      </div>
      {!ready && <div className="pg-skip">{t('title.skip')} <kbd>Esc</kbd></div>}

      <aside className="pg-title-keys">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t('title.key.explore')}</span>
        <span><kbd>E</kbd> {t('title.key.encounter')}</span>
        <span><kbd>🖱</kbd> {t('title.key.throw')}</span>
      </aside>

      <footer className="pg-ticker">
        <span className="pg-ticker-tag">{t('title.ticker.live')}</span>
        <div className="pg-ticker-win">
          {feed.length ? (
            <div className="pg-ticker-run" style={{ animationDuration: `${Math.max(30, feed.length * 6)}s` }}>
              {[...feed, ...feed].map((f, i) => <TickerItem key={`${f.id}-${i}`} f={f} />)}
            </div>
          ) : (
            <div className="pg-ticker-idle">{t('title.ticker.idle')}</div>
          )}
        </div>
      </footer>
    </div>
  );
};

/** Una línea del logo partida en letras para que entren una a una (`--i` escalona el retardo). */
const LogoLine: React.FC<{ cls: string; text: string; at: number }> = ({ cls, text, at }) => (
  <span className={cls} aria-hidden>
    {[...text].map((ch, i) => <span key={i} className="ch" data-t={ch} style={{ ['--i' as string]: at + i }}>{ch}</span>)}
  </span>
);

const TickerItem: React.FC<{ f: FeedRow }> = ({ f }) => {
  const t = useT();
  const who = f.trainer_name ?? t('ticker.aTrainer');
  const tok = f.symbol ? `$${f.symbol}` : f.species ?? t('ticker.aMonster');
  const verb = t(f.kind === 'discover' ? 'ticker.discovered' : f.kind === 'evolve' ? 'ticker.evolved' : 'ticker.caught');
  return (
    <span className={`pg-tick k-${f.kind}`}>
      {f.logo ? <img src={imgUrl(f.logo, 40)} alt="" /> : <i className="dot" />}
      <b>{who}</b> {verb} {f.shiny ? '✨ ' : ''}<em>{tok}</em>
    </span>
  );
};
