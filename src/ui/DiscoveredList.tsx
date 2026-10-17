// "Discovered tokens" del Dex: cada token de Arc que algún entrenador atrapó por primera vez, en el
// orden en que se descubrieron, con quién lo descubrió. Filtros: todos, atrapados por mí y evolucionados.
import React, { useEffect, useState } from 'react';
import { api, type DiscoveredToken } from '../../lib/featuresApi';
import { useCapture } from '../world/captureStore';
import { fmtUsd } from '../world/tokenSpecies';
import { t, useT } from '../i18n';
import { TokenDetail } from './DexDetail';
import './parity.css';
import './polish/panels.css';

type Filter = 'all' | 'mine' | 'evolved';

export const DiscoveredList: React.FC = () => {
  useT();
  const cap = useCapture();
  const [list, setList] = useState<DiscoveredToken[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [e, setE] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState<DiscoveredToken | null>(null);
  const more = async () => {
    if (next === null || loading) return;
    setLoading(true);
    try { const r = await api.discovered(next); setList((l) => [...l, ...r.tokens]); setNext(r.next); } catch (x) { setE((x as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void more(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = new Set(cap.collection.map((m) => m.token?.address).filter(Boolean));
  const shown = list.filter((x) => filter === 'all' || (filter === 'mine' ? mine.has(x.address) : x.stage > 1));
  return (
    <div className="pg-pn pg-dx-wrap">
      <p className="pg-mart-note">{t('dx.note')}</p>
      <div className="pg-f-tabs">
        {(['all', 'mine', 'evolved'] as Filter[]).map((k) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(`dx.f.${k}` as 'dx.f.all')}</button>)}
      </div>
      {e && <div className="pg-f-err">{e}</div>}
      <div className="pg-list pg-dx">
        {shown.map((x, i) => (
          <button
            type="button"
            className={`pg-row pg-lb ${mine.has(x.address) ? 'mine' : ''}`}
            key={x.address}
            style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
            onClick={() => setFocus(x)}
          >
            <span className="no">#{x.dexNo}</span>
            {x.logo ? <img className="pg-p-logo" src={x.logo} alt="" /> : <span className="pg-p-logo ph">{x.symbol.slice(0, 1)}</span>}
            <span className="nm">${x.symbol}{mine.has(x.address) ? ' ✓' : ''}</span>
            <span className="pg-lb-sub">{fmtUsd(x.mcap)} · {t('dx.stage', { n: x.stage })} · {t('dx.by', { name: x.by ?? '?' })}</span>
          </button>
        ))}
      </div>
      {!loading && !shown.length && <p className="pg-empty">{t('dx.empty')}</p>}
      {next !== null && <div className="pg-f-actions"><button className="pg-btn" disabled={loading} onClick={more}>{loading ? '…' : t('dx.more')}</button></div>}
      {focus && <TokenDetail tok={focus} mine={mine.has(focus.address)} onClose={() => setFocus(null)} />}
    </div>
  );
};
