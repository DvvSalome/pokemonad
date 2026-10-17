import React, { useEffect, useState } from 'react';
import { call, isOnline, type ServerTrainer, type TokenInfo } from '../../lib/api';
import { setTrainer, useOnline } from '../world/online';
import { useWallet, connect } from '../world/walletStore';
import './features.css';
import './polish/panels.css';
import { t as tr, tk, useT, type Key } from '../i18n';

const fmt = (v: string | null | undefined) => {
  if (v == null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 4 : 0 }) : v;
};
const CAT_LABEL: Record<string, Key> = { league: 'tok.cat.league', arena: 'tok.cat.arena', discoverer: 'tok.cat.discoverer' };
/** Lo que añade features.ts del servidor: premios instantáneos, ventajas extra por nivel y evento de temporada. */
type Extra = {
  bounties?: { golden: string; legendary: string; dex: Record<string, string> };
  perks?: Record<string, { league: number; radar: boolean }>;
  season?: { name: string; from: number; to: number; mult: number } | null;
};

/**
 * Pantalla del token (el `launch.json` del original): dirección para copiar, comprar, gráfico, quemado y tesorería,
 * niveles por holdear y premios. Todo sale de la acción pública `token` del servidor: cambiar de testnet a mainnet
 * es cambiar sus secrets, no esta ventana.
 */
export const TokenPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useT();
  const online = useOnline();
  const wallet = useWallet();
  const t = online.trainer;
  const [info, setInfo] = useState<(TokenInfo & { extra?: Extra }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isOnline()) return;
    call<TokenInfo>('token').then(setInfo, (e) => setErr((e as Error).message));
  }, [online.status]);

  const copy = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.address); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* copiar a mano */ }
  };
  const recheck = async () => {
    setChecking(true);
    try { setTrainer((await call<{ trainer: ServerTrainer }>('holder', { force: true })).trainer); } catch (e) { setErr((e as Error).message); }
    setChecking(false);
  };
  const h = t?.holder;

  return (
    <div className="pg-drawer pg-win pg-pn k-token">
      <h3>{info ? `$${info.symbol}` : 'Token'} <button className="x" onClick={onClose}>✕</button></h3>
      {!info ? (
        <p className="pg-mart-note">{err ?? tr(online.status === 'online' ? 'common.loading' : 'tok.needsServer')}</p>
      ) : (
        <>
          <p className="pg-mart-note">
            {tr('tok.on', { name: info.name, chain: info.chainName })}{!info.mainnet && tr('tok.testnet')}
          </p>
          <div className="pg-f-ca">
            <code>{info.address}</code>
            <button className="pg-btn small" onClick={() => void copy()}>{tr(copied ? 'common.copied' : 'common.copy')}</button>
          </div>
          <div className="pg-f-actions">
            <a className="pg-btn small" href={info.buyUrl} target="_blank" rel="noreferrer">{info.mainnet ? tr('tok.buy', { symbol: info.symbol }) : tr('tok.getTest', { symbol: info.symbol })}</a>
            <a className="pg-btn small ghost" href={info.chartUrl} target="_blank" rel="noreferrer">{tr('tok.chart')}</a>
            <a className="pg-btn small ghost" href={info.tokenUrl} target="_blank" rel="noreferrer">{tr('tok.explorer')}</a>
          </div>

          <div className="pg-f-stats">
            <div className="pg-f-stat"><small>{tr('tok.burned')}</small><b>{fmt(info.stats.burned)}</b></div>
            <div className="pg-f-stat"><small>{tr('tok.spent')}</small><b>{fmt(info.stats.martTotal)}</b><small>{tr('tok.payments', { n: info.stats.martPayments })}</small></div>
            {info.martMode === 'treasury' && <div className="pg-f-stat"><small>{tr('tok.treasury')}</small><b>{fmt(info.stats.treasuryBalance)}</b></div>}
          </div>
          <p className="pg-mart-note">
            {info.martMode === 'burn'
              ? tr('tok.burnNote', { symbol: info.symbol })
              : tr('tok.treasuryNote', { addr: `${info.treasury.slice(0, 6)}…${info.treasury.slice(-4)}` })}
          </p>
          <p className="pg-mart-note">{tr('tok.loopNote', { symbol: info.symbol })}</p>

          <h4 className="pg-sub">{tr('tok.tiers')}</h4>
          <p className="pg-mart-note">{tr('tok.tiersNote', { symbol: info.symbol })}</p>
          <div className="pg-f-tiers">
            {info.tiers.map((x) => (
              <div className={`pg-f-tier ${h?.tier === x.tier ? 'on' : ''}`} key={x.tier}>
                {h?.tier === x.tier && <em>{tr('tok.you')}</em>}
                <b>{x.tier}</b>
                <span>{tr('tok.from', { min: fmt(x.min), symbol: info.symbol })}</span>
                <span>{tk(`perks.${x.tier}`, x.perks)}</span>
                {info.extra?.perks?.[x.tier] && (
                  <span>{tr('tok.perkLeague', { p: Math.round(info.extra.perks[x.tier].league * 100) })}{info.extra.perks[x.tier].radar ? ` · ${tr('tok.perkRadar')}` : ''} · {tr('tok.perkSummit')}</span>
                )}
              </div>
            ))}
          </div>
          {t && (t.wallet ? (
            <div className="pg-f-row">
              {tr('tok.balance')} <b>{fmt(h?.balance)} {info.symbol}</b>
              {h?.tier ? <span className={`pg-tierchip t-${h.tier}`}>{h.tier}</span> : <span>{tr('tok.noTier')}</span>}
              {h?.next && <span>{tr('tok.next', { tier: h.next.tier, min: fmt(h.next.min) })}</span>}
              <button className="pg-btn small ghost" disabled={checking} onClick={() => void recheck()}>{tr(checking ? 'tok.checking' : 'tok.recheck')}</button>
            </div>
          ) : (
            <div className="pg-f-row">
              {tr('tok.linkForTier')}
              <button className="pg-btn small" disabled={wallet.status === 'connecting'} onClick={() => void connect()}>{tr('common.connectWallet')}</button>
            </div>
          ))}

          <h4 className="pg-sub">{tr('tok.prizes')}</h4>
          <p className="pg-mart-note">
            {tr('tok.prizesNote', { symbol: info.symbol, min: fmt(info.prizeMinHold) })}
          </p>
          <table className="pg-f-table">
            <thead><tr><th>{tr('tok.category')}</th><th>{tr('tok.byPlace')}</th></tr></thead>
            <tbody>
              {Object.entries(info.prizes).map(([k, v]) => (
                <tr key={k}><td>{CAT_LABEL[k] ? tr(CAT_LABEL[k]) : tk(`cat.${k}`, k)}</td><td>{v.map((a, i) => `#${i + 1}: ${fmt(a)}`).join(' · ')} {info.symbol}</td></tr>
              ))}
              {info.extra?.bounties && (
                <>
                  <tr><td>{tr('cat.golden')}</td><td>{fmt(info.extra.bounties.golden)} {info.symbol} · {tr('tok.bountyGolden')}</td></tr>
                  <tr><td>{tr('cat.legendary')}</td><td>{fmt(info.extra.bounties.legendary)} {info.symbol} · {tr('tok.bountyLegend')}</td></tr>
                  <tr><td>{tr('cat.dex')}</td><td>{Object.entries(info.extra.bounties.dex).map(([n, a]) => `${n}: ${fmt(a)}`).join(' · ')} {info.symbol}</td></tr>
                </>
              )}
            </tbody>
          </table>
          {info.extra?.season && (
            <p className="pg-mart-note">{tr('tok.season', { name: info.extra.season.name, from: new Date(info.extra.season.from).toLocaleDateString(), to: new Date(info.extra.season.to - 1).toLocaleDateString(), m: info.extra.season.mult })}</p>
          )}
          <p className="pg-mart-note" style={{ marginTop: 12 }}>{tr('tok.notInvestment')}</p>
        </>
      )}
    </div>
  );
};
