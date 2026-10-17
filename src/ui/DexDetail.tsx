// Detalle de una especie del Dex: stats de captura, hábitat y botón para volar a la zona.
import React, { useEffect, useState } from 'react';
import { SPECIES_CATALOG, TYPE_COLORS, BALLS, baseCatch, catchChance } from '../world/species';
import { fighter } from '../world/battleMath';
import { portrait } from '../world/portrait';
import { modelOf } from '../world/tokenSpecies';
import { warpToZone } from '../world/wildStore';
import { zoneName } from './Minimap';
import { t, useT } from '../i18n';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export const DexDetail: React.FC<{
  speciesId: string;
  seen: boolean;
  onClose: () => void;
  onFly: () => void;
}> = ({ speciesId, seen, onClose, onFly }) => {
  useT();
  const sp = SPECIES_CATALOG.find((s) => s.id === speciesId);
  const [img, setImg] = useState('');
  useEffect(() => {
    if (!sp) return;
    let alive = true;
    portrait(modelOf(sp.id, 1)).then((u) => alive && setImg(u));
    return () => { alive = false; };
  }, [sp]);
  if (!sp) return null;
  const no = SPECIES_CATALOG.findIndex((s) => s.id === sp.id) + 1;
  const base = baseCatch(sp.rate);
  const f = fighter(sp.id, 5);
  const fly = () => {
    warpToZone(sp.zone);
    onFly();
    onClose();
  };
  return (
    <div className="pg-overlay pg-dex-detail" onClick={onClose}>
      <div className={`pg-dex-sheet t-${sp.tier}`} onClick={(e) => e.stopPropagation()} style={{ ['--tc' as string]: TYPE_COLORS[sp.type] }}>
        <button className="x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        <div className="pg-dex-top">
          <div className={`pg-dex-pic ${seen ? 'seen' : 'unseen'}`}>
            {img ? <img src={img} alt="" /> : <i className="spin" />}
          </div>
          <div className="pg-dex-id">
            <div className="pg-dex-no">
              #{String(no).padStart(3, '0')}
              <span className={seen ? 'ok' : 'miss'}>{seen ? t('dex.caught') : t('dex.missing')}</span>
            </div>
            <h2>{seen ? sp.name : '???'}</h2>
            <div className="pg-dex-tags">
              <span className="pg-chip" style={{ ['--c' as string]: TYPE_COLORS[sp.type] }}>{sp.type}</span>
              <span className={`pg-rar t-${sp.tier}`}>{sp.tier}</span>
            </div>
            <p className="pg-dex-blurb">
              {seen
                ? t('dex.livesIn', { zone: zoneName(sp.zone) })
                : t('dex.livesHidden', { zone: zoneName(sp.zone) })}
            </p>
          </div>
        </div>
        <div className="pg-dex-stats">
          <div><b>{sp.rate}/255</b><span>{t('dex.catchRate')}</span></div>
          <div><b>{pct(catchChance(base, 'ball', 1))}</b><span>{t('dex.perBall', { ball: BALLS.ball.name })}</span></div>
          <div><b>{pct(catchChance(base, 'hyper', 1))}</b><span>{t('dex.perBall', { ball: BALLS.hyper.name })}</span></div>
          <div><b>ATK {f.atk}</b><span>DEF {f.def} · SPD {f.spd}</span></div>
        </div>
        <div className="pg-dex-actions">
          <button className="pg-btn gold" onClick={fly}>{t('dex.findIn', { zone: zoneName(sp.zone) })}</button>
        </div>
      </div>
    </div>
  );
};

export const TokenDetail: React.FC<{
  tok: { address: string; symbol: string; name: string; logo: string | null; mcap: number; stage: number; dexNo: number; catches: number; by: string | null };
  mine: boolean;
  onClose: () => void;
}> = ({ tok, mine, onClose }) => {
  useT();
  const short = `${tok.address.slice(0, 6)}…${tok.address.slice(-4)}`;
  return (
    <div className="pg-overlay pg-dex-detail" onClick={onClose}>
      <div className="pg-dex-sheet tok" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        <div className="pg-dex-top">
          <div className="pg-dex-pic seen tok-logo">
            {tok.logo ? <img src={tok.logo} alt="" /> : <span className="ph">{tok.symbol.slice(0, 1)}</span>}
          </div>
          <div className="pg-dex-id">
            <div className="pg-dex-no">
              #{tok.dexNo}
              {mine && <span className="ok">{t('dex.caught')}</span>}
            </div>
            <h2>${tok.symbol}</h2>
            <p className="pg-dex-blurb">{tok.name}</p>
            <p className="pg-dex-blurb muted">{short}</p>
          </div>
        </div>
        <div className="pg-dex-stats">
          <div><b>{tok.mcap >= 1e6 ? `$${(tok.mcap / 1e6).toFixed(2)}M` : tok.mcap >= 1e3 ? `$${(tok.mcap / 1e3).toFixed(1)}K` : `$${Math.round(tok.mcap)}`}</b><span>{t('dex.mcap')}</span></div>
          <div><b>{t('dx.stage', { n: tok.stage })}</b><span>{t('dex.form')}</span></div>
          <div><b>{tok.catches}</b><span>{t('dex.catches')}</span></div>
          <div><b>{tok.by ?? '—'}</b><span>{t('dex.discoverer')}</span></div>
        </div>
        <div className="pg-dex-actions">
          <a className="pg-btn ghost" href={`https://dexscreener.com/arc/${tok.address}`} target="_blank" rel="noreferrer">{t('dex.chart')}</a>
          <button className="pg-btn gold" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
};
