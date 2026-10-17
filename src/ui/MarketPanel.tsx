// Mercado de cartas, como el Card Market del original: pones una carta de tu Caja a la venta con un precio en el
// token del juego y quien la compra paga directo de su wallet a la tuya (un transfer ERC-20). El juego nunca toca el
// dinero: reserva la carta 15 min al comprador, comprueba el pago en la cadena y entonces mueve la carta.
import React, { useCallback, useEffect, useState } from 'react';
import { formatUnits, type Address, type Hash } from 'viem';
import { api, type Listing, type MarketResult } from '../../lib/featuresApi';
import { ApiError } from '../../lib/api';
import { sendToken, tokenBalance, waitReceipt } from '../../lib/arc/chain';
import { FAUCET_URL, txUrl } from '../../lib/arc/payConfig';
import { getCollection } from '../world/captureStore';
import { refreshMe, useOnline } from '../world/online';
import { connectForPayment, refreshWalletBalance } from '../world/walletStore';
import { portrait } from '../world/portrait';
import { t, useT } from '../i18n';
import './features.css';
import './parity.css';
import './polish/panels.css';

type Tab = 'buy' | 'sell' | 'mine' | 'sold';
const err = (e: unknown) => {
  for (let x = e as { name?: string; code?: number; cause?: unknown } | undefined, i = 0; x && i < 6; x = x.cause as typeof x, i++) {
    if (x.name === 'UserRejectedRequestError' || x.code === 4001) return t('mart.errCancelled');
  }
  return (e as { shortMessage?: string })?.shortMessage ?? (e instanceof Error ? e.message : String(e));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pagos enviados cuya carta aún no se entregó (se cerró la pestaña a mitad): se reclaman al abrir el mercado. */
const PENDING_KEY = 'pg-market-pending-v1';
type Pending = { id: string; hash: Hash };
const readPending = (): Pending[] => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } };
const writePending = (p: Pending[]) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* sin storage */ } };
const dropPending = (hash: string) => writePending(readPending().filter((p) => p.hash !== hash));

async function claim(id: string, hash: Hash) {
  for (let i = 0; ; i++) {
    try { return await api.marketBuy(id, hash); } catch (e) {
      if (!(e instanceof ApiError && [404, 425, 502].includes(e.status)) || i >= 12) throw e;
      await sleep(2500);
    }
  }
}

const CardPic: React.FC<{ l: Pick<Listing, 'model' | 'logo' | 'symbol' | 'shiny'> }> = ({ l }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    portrait(l.model, { logo: l.logo ?? undefined, symbol: l.symbol ?? undefined, shiny: l.shiny }).then((u) => alive && setSrc(u)).catch(() => {});
    return () => { alive = false; };
  }, [l.model, l.logo, l.symbol, l.shiny]);
  return <span className="pg-p-pic" style={{ width: 72, height: 72 }}>{src ? <img src={src} alt="" /> : <i className="spin" />}</span>;
};

export const MarketPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useT();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('buy');
  const [m, setM] = useState<MarketResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string; faucet?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [price, setPrice] = useState('');

  const load = useCallback(async () => {
    try { setM(await api.market()); } catch (e) { setMsg({ ok: false, text: err(e) }); }
  }, []);
  useEffect(() => {
    if (online.status !== 'online') return;
    void load();
    // Compras pagadas pero no entregadas (p. ej. se cerró la pestaña): se reclaman ahora.
    void (async () => {
      for (const p of readPending()) {
        try { await api.marketBuy(p.id, p.hash); dropPending(p.hash); setMsg({ ok: true, text: t('mk.delivered') }); void refreshMe(); }
        catch (e) { if (e instanceof ApiError && [402, 404, 409].includes(e.status)) dropPending(p.hash); }
      }
    })();
  }, [online.status, load]);

  const buy = async (l: Listing) => {
    if (busy) return;
    setBusy(l.id); setMsg({ ok: true, text: t('pay.connecting') });
    let sent: Hash | null = null;
    try {
      const conn = await connectForPayment();
      const q = await api.marketQuote(l.id);
      const amount = BigInt(q.amount);
      const have = await tokenBalance(q.token as Address, conn.address).catch(() => null);
      if (have !== null && have < amount) {
        setMsg({ ok: false, faucet: !!FAUCET_URL, text: t('mart.errFunds', { symbol: q.symbol, have: formatUnits(have, m?.decimals ?? 6), cost: q.price }) });
        return;
      }
      setMsg({ ok: true, text: t('mk.signing', { price: q.price, symbol: q.symbol }) });
      sent = await sendToken(conn, q.token as Address, q.to as Address, amount);
      writePending([...readPending(), { id: l.id, hash: sent }]);
      setMsg({ ok: true, text: t('pay.confirming'), hash: sent });
      const rc = await waitReceipt(sent);
      if (rc.status !== 'success') { dropPending(sent); throw new Error(t('mart.errTxFailed')); }
      await claim(l.id, sent);
      dropPending(sent);
      refreshWalletBalance();
      await refreshMe();
      setMsg({ ok: true, text: t('mk.bought', { name: l.name }), hash: sent });
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && sent) dropPending(sent);
      const tail = sent && readPending().some((p) => p.hash === sent) ? ` ${t('mart.savedTail')}` : '';
      setMsg({ ok: false, text: err(e) + tail, hash: sent ?? undefined });
    } finally { setBusy(null); }
  };

  const list = async () => {
    if (!pick) return;
    setBusy('list'); setMsg(null);
    try { await api.marketList(pick, price.trim()); setMsg({ ok: true, text: t('mk.listed') }); setPick(null); setPrice(''); await load(); setTab('mine'); void refreshMe(); }
    catch (e) { setMsg({ ok: false, text: err(e) }); } finally { setBusy(null); }
  };
  const unlist = async (l: Listing) => {
    setBusy(l.id); setMsg(null);
    try { await api.marketUnlist(l.id); setMsg({ ok: true, text: t('mk.unlisted') }); await load(); }
    catch (e) { setMsg({ ok: false, text: err(e) }); } finally { setBusy(null); }
  };

  if (online.status !== 'online') {
    return <div className="pg-drawer pg-win pg-pn k-market"><h3>{t('nav.market')} <button className="x" onClick={onClose}>✕</button></h3><p className="pg-empty">{t('bt.needsServer')}</p></div>;
  }
  const listed = new Set((m?.mine ?? []).filter((l) => l.status === 'open').map((l) => l.id));
  const listedSpawns = new Set((m?.mine ?? []).filter((l) => l.status === 'open').map((l) => l.spawnId));
  const mine = getCollection();
  const others = (m?.listings ?? []).filter((l) => !l.mine);
  return (
    <div className="pg-drawer pg-win pg-pn k-market">
      <h3>{t('nav.market')} <button className="x" onClick={onClose}>✕</button></h3>
      <p className="pg-mart-note">{t('mk.note', { symbol: m?.symbol ?? 'USDC', chain: m?.chainName ?? '' })}</p>
      <div className="pg-f-tabs">
        {(['buy', 'sell', 'mine', 'sold'] as Tab[]).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(null); }}>{t(`mk.tab.${k}` as 'mk.tab.buy')}</button>
        ))}
      </div>
      {msg && (
        <div className={msg.ok ? 'pg-f-ok' : 'pg-f-err'}>
          {msg.text}
          {msg.faucet && FAUCET_URL && <> <a className="pg-link" href={FAUCET_URL} target="_blank" rel="noreferrer">faucet.circle.com</a></>}
          {msg.hash && <> · <a className="pg-link" href={txUrl(msg.hash)} target="_blank" rel="noreferrer">{t('mart.viewTx')}</a></>}
        </div>
      )}
      {!m ? <p className="pg-empty">{t('common.loading')}</p> : tab === 'buy' ? (
        !others.length ? <p className="pg-empty">{t('mk.empty')}</p> : (
          <div className="pg-p-market">
            {others.map((l, i) => (
              <div className={`pg-p-listing t-${l.tier}${l.shiny ? ' shiny' : ''}${l.reserved ? ' reserved' : ''}${busy === l.id ? ' busy' : ''}`} key={l.id} style={{ '--i': i } as React.CSSProperties}>
                <CardPic l={l} />
                <b>{l.shiny ? '✨ ' : ''}{l.name}</b>
                <span className="meta"><span className={`pg-rar t-${l.tier}`}>{l.tier}</span><small>{t('mk.stage', { n: l.stage })}{l.symbol ? ` · $${l.symbol}` : ''}</small></span>
                <small className="seller">{t('mk.seller', { name: l.seller ?? '?' })}</small>
                <span className="price">{l.price} {m.symbol}</span>
                <button className="pg-btn small" disabled={!!busy || l.reserved} onClick={() => buy(l)}>
                  {busy === l.id ? '…' : l.reserved ? t('mk.reserved') : t('mk.buy')}
                </button>
              </div>
            ))}
          </div>
        )
      ) : tab === 'sell' ? (
        !m.wallet ? <p className="pg-pay-block">{t('mk.needWallet', { symbol: m.symbol })}</p> : (
          <>
            <p className="pg-mart-note">{t('mk.sellNote', { min: m.min, max: m.max, symbol: m.symbol })}</p>
            <div className="pg-f-mons">
              {mine.filter((c) => !listedSpawns.has(c.id)).map((c) => (
                <button key={c.id} className={`pg-f-mon t-${c.tier} ${pick === c.id ? 'on' : ''}`} onClick={() => setPick(c.id)}>
                  {c.shiny ? '✨ ' : ''}{c.name}<small>{c.tier} · {t('mk.stage', { n: c.stage })}</small>
                </button>
              ))}
            </div>
            <div className="pg-f-row">
              <input className="pg-f-input" inputMode="decimal" placeholder={t('mk.pricePh', { symbol: m.symbol })} value={price}
                onChange={(e) => setPrice(e.target.value.replace(',', '.'))} onKeyDown={(e) => e.stopPropagation()} />
              <button className="pg-btn" disabled={!pick || !price || busy === 'list'} onClick={list}>{t('mk.list')}</button>
            </div>
          </>
        )
      ) : tab === 'mine' ? (
        !m.mine.length ? <p className="pg-empty">{t('mk.noMine')}</p> : (
          <div className="pg-f-list">
            {m.mine.map((l, i) => (
              <div className={`pg-f-item st-${l.status}`} key={l.id} style={{ '--i': i } as React.CSSProperties}>
                <div className="grow"><b>{l.shiny ? '✨ ' : ''}{l.name}</b><span>{l.price} {m.symbol} · {t(`mk.st.${l.status}` as 'mk.st.open')}</span></div>
                {l.status === 'open' && listed.has(l.id) && <button className="pg-btn" disabled={!!busy} onClick={() => unlist(l)}>{t('mk.unlist')}</button>}
                {l.tx && <a className="pg-link" href={txUrl(l.tx)} target="_blank" rel="noreferrer">{t('mart.viewTx')}</a>}
              </div>
            ))}
          </div>
        )
      ) : (
        !m.sold.length ? <p className="pg-empty">{t('mk.noSold')}</p> : (
          <div className="pg-f-list">
            {m.sold.map((l, i) => (
              <div className="pg-f-item st-sold" key={l.id} style={{ '--i': i } as React.CSSProperties}>
                <div className="grow"><b>{l.shiny ? '✨ ' : ''}{l.name}</b><span>{l.price} {m.symbol} · {t('mk.seller', { name: l.seller ?? '?' })}</span></div>
                {l.tx && <a className="pg-link" href={txUrl(l.tx)} target="_blank" rel="noreferrer">{t('mart.viewTx')}</a>}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};
