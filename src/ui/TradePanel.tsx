import React, { useCallback, useEffect, useState } from 'react';
import { call, type ServerMon } from '../../lib/api';
import { refreshMe, useOnline } from '../world/online';
import { usePresence, sendHint, livePositions, onHint } from '../world/presenceStore';
import { say } from '../world/martStore';
import { playerPos } from '../world/wildStore';
import { getCollection } from '../world/captureStore';
import './features.css';
import './polish/panels.css';
import { t as tr, useT, type Key } from '../i18n';

interface Mon { id: string; name: string; tier: string; shiny: boolean; stage: number }
export interface Trade {
  id: string; status: 'pending' | 'done' | 'declined' | 'cancelled'; mine: boolean; at: number;
  from: { id: string; name: string }; to: { id: string; name: string }; give: Mon; want: Mon;
}
interface Who { id: string; name: string; dist?: number }

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const monLabel = (m: Pick<Mon, 'name' | 'tier' | 'shiny' | 'stage'>) => `${m.shiny ? '✨ ' : ''}${m.name}`;

export const fetchTrades = () => call<{ trades: Trade[] }>('trades').then((r) => r.trades);

/** Ofertas que esperan mi respuesta: se miran cada minuto y al instante cuando llega un aviso por Realtime. */
export function useIncomingTrades(enabled: boolean, open: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => fetchTrades().then((ts) => { if (alive) setN(ts.filter((t) => !t.mine && t.status === 'pending').length); }, () => {});
    void load();
    const t = setInterval(load, 60_000);
    const off = onHint((_from, kind) => {
      if (!kind.startsWith('trade')) return;
      void load();
      if (kind === 'trade') say(tr('trade.gotOffer'));
      if (kind === 'trade-done') { say(tr('trade.accepted')); void refreshMe(); }
    });
    return () => { alive = false; clearInterval(t); off(); };
  }, [enabled, open]);
  return n;
}

/**
 * Intercambios 1 por 1 entre jugadores. El servidor es la autoridad: la oferta guarda qué das y qué pides, y al
 * aceptar se cambian de dueño los dos a la vez (o nada). Aquí solo se elige y se avisa al otro por Realtime.
 */
export const TradePanel: React.FC<{ onClose: () => void; onChanged?: () => void }> = ({ onClose, onChanged }) => {
  useT();
  const { trainer } = useOnline();
  const { players } = usePresence();
  const [tab, setTab] = useState<'new' | 'offers'>('new');
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [who, setWho] = useState<Who | null>(null);
  const [theirs, setTheirs] = useState<ServerMon[] | null>(null);
  const [give, setGive] = useState<string | null>(null);
  const [want, setWant] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Who[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadTrades = useCallback(async () => {
    try { setTrades(await fetchTrades()); } catch (e) { setMsg({ ok: false, text: err(e) }); }
  }, []);
  useEffect(() => { void loadTrades(); }, [loadTrades]);

  const mine = getCollection();
  const me = playerPos;
  const nearby: Who[] = players.map((p) => {
    const lp = livePositions.get(p.id) ?? p;
    return { id: p.id, name: p.name, dist: Math.hypot(lp.x - me.x, lp.z - me.z) };
  }).sort((a, b) => a.dist - b.dist);

  const pick = async (w: Who) => {
    setWho(w); setTheirs(null); setWant(null); setMsg(null);
    try { setTheirs((await call<{ box: ServerMon[] }>('trainer-box', { id: w.id })).box); }
    catch (e) { setMsg({ ok: false, text: err(e) }); }
  };
  const search = async () => {
    setMsg(null); setFound(null);
    try {
      const r = await call<{ trainers: Who[] }>('trainer-find', { name: q });
      setFound(r.trainers.filter((x) => x.id !== trainer?.id));
    } catch (e) { setMsg({ ok: false, text: err(e) }); }
  };
  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await loadTrades(); onChanged?.(); }
    catch (e) { setMsg({ ok: false, text: err(e) }); }
    finally { setBusy(false); }
  };
  const offer = () => act(async () => {
    if (!who || !give || !want) throw new Error(tr('trade.pickBoth'));
    await call('trade-offer', { to: who.id, give, want });
    sendHint(who.id, 'trade');
    setGive(null); setWant(null); setTab('offers');
    return tr('trade.sent', { name: who.name });
  });
  const accept = (t: Trade) => act(async () => {
    await call('trade-accept', { id: t.id });
    await refreshMe();
    sendHint(t.from.id, 'trade-done');
    return tr('trade.done', { name: t.give.name });
  });
  const close = (t: Trade) => act(async () => {
    await call('trade-close', { id: t.id });
    if (!t.mine) sendHint(t.from.id, 'trade-declined');
    return tr(t.mine ? 'trade.cancelled' : 'trade.declined');
  });

  if (!trainer) {
    return (
      <div className="pg-drawer pg-win pg-pn k-trade">
        <h3>{tr('nav.trade')} <button className="x" onClick={onClose}>✕</button></h3>
        <p>{tr('trade.needsServer')}</p>
      </div>
    );
  }

  const incoming = (trades ?? []).filter((t) => !t.mine && t.status === 'pending').length;
  return (
    <div className="pg-drawer pg-win pg-pn k-trade">
      <h3>{tr('nav.trade')} <button className="x" onClick={onClose}>✕</button></h3>
      <div className="pg-f-tabs">
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>{tr('trade.new')}</button>
        <button className={tab === 'offers' ? 'on' : ''} onClick={() => { setTab('offers'); void loadTrades(); }}>
          {tr('trade.offers')}{incoming ? ` (${incoming})` : ''}
        </button>
      </div>
      {msg && <div className={msg.ok ? 'pg-f-ok' : 'pg-f-err'}>{msg.text}</div>}

      {tab === 'new' && !who && (
        <>
          <h4>{tr('trade.online')}</h4>
          {!nearby.length && <p><small>{tr('trade.nobody')}</small></p>}
          <div className="pg-f-list">
            {nearby.slice(0, 8).map((p) => (
              <div className="pg-f-item" key={p.id}>
                <div className="grow"><b>{p.name}</b><span>{p.dist! < 1000 ? tr('trade.away', { m: Math.round(p.dist!) }) : tr('trade.onlineTag')}</span></div>
                <button className="pg-btn" onClick={() => pick(p)}>{tr('trade.trade')}</button>
              </div>
            ))}
          </div>
          <h4>{tr('trade.find')}</h4>
          <div className="pg-f-row">
            <input className="pg-f-input" placeholder={tr('trade.namePh')} value={q} maxLength={20}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void search(); }} />
            <button className="pg-btn" onClick={search} disabled={q.trim().length < 3}>{tr('trade.search')}</button>
          </div>
          {found && !found.length && <p><small>{tr('trade.noTrainer')}</small></p>}
          <div className="pg-f-list">
            {found?.map((p) => (
              <div className="pg-f-item" key={p.id}>
                <div className="grow"><b>{p.name}</b></div>
                <button className="pg-btn" onClick={() => pick(p)}>{tr('trade.trade')}</button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'new' && who && (
        <>
          <div className="pg-f-row">{tr('trade.with')} <b>{who.name}</b> <button className="pg-btn" onClick={() => setWho(null)}>{tr('trade.change')}</button></div>
          <h4>{tr('trade.youGive')}</h4>
          {!mine.length && <p><small>{tr('trade.boxEmpty')}</small></p>}
          <div className="pg-f-mons">
            {mine.map((m) => (
              <button key={m.id} className={`pg-f-mon t-${m.tier} ${give === m.id ? 'on' : ''}`} onClick={() => setGive(m.id)}>
                {monLabel({ ...m, shiny: !!m.shiny })}<small>{tr('trade.stage', { tier: m.tier, n: m.stage })}</small>
              </button>
            ))}
          </div>
          <h4>{tr('trade.youGet')}</h4>
          {!theirs && <p>{tr('trade.loadingTheirs')}</p>}
          {theirs && !theirs.length && <p><small>{tr('trade.theirEmpty')}</small></p>}
          <div className="pg-f-mons">
            {theirs?.map((m) => (
              <button key={m.id} className={`pg-f-mon t-${m.tier} ${want === m.id ? 'on' : ''}`} onClick={() => setWant(m.id)}>
                {monLabel(m)}<small>{tr('trade.stage', { tier: m.tier, n: m.stage })}</small>
              </button>
            ))}
          </div>
          <div className="pg-f-actions">
            <button className="pg-btn" disabled={busy || !give || !want} onClick={offer}>{tr(busy ? 'trade.sending' : 'trade.send')}</button>
          </div>
          <p><small>{tr('trade.mustAccept')}</small></p>
        </>
      )}

      {tab === 'offers' && (
        <div className="pg-f-list">
          {!trades && <p>{tr('common.loading')}</p>}
          {trades && !trades.length && <p><small>{tr('trade.noOffers')}</small></p>}
          {trades?.map((t, i) => (
            <div className={`pg-f-item st-${t.status}${!t.mine && t.status === 'pending' ? ' incoming' : ''}`} key={t.id} style={{ '--i': i } as React.CSSProperties}>
              <div className="grow">
                <b>{t.mine ? tr('trade.to', { name: t.to.name }) : tr('trade.from', { name: t.from.name })}</b>
                <span>
                  {tr(t.mine ? 'trade.youGive' : 'trade.youGet')} {monLabel(t.give)} · {tr(t.mine ? 'trade.youGetLc' : 'trade.youGiveLc')} {monLabel(t.want)}
                </span>
              </div>
              {t.status === 'pending' && !t.mine && <>
                <button className="pg-btn" disabled={busy} onClick={() => accept(t)}>{tr('trade.accept')}</button>
                <button className="pg-btn" disabled={busy} onClick={() => close(t)}>{tr('trade.decline')}</button>
              </>}
              {t.status === 'pending' && t.mine && <button className="pg-btn" disabled={busy} onClick={() => close(t)}>{tr('trade.cancel')}</button>}
              {t.status !== 'pending' && <span className={`pg-f-tag ${t.status === 'done' ? 'paid' : ''}`}>{tr(`trade.st.${t.status}` as Key)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
