import React, { useCallback, useEffect, useState } from 'react';
import { parseUnits, type Address, type Hash } from 'viem';
import { ApiError, call, type PrizeCat, type PrizeRow } from '../../lib/api';
import { sendToken, waitReceipt } from '../../lib/arc/chain';
import { connectForPayment, shortAddr } from '../world/walletStore';
import './features.css';
import './polish/panels.css';
import { t, tk, useT, type Key } from '../i18n';
import { rich } from '../i18n/rich';

interface AdminView {
  week: number; weekEndsAt: number; admin: string; token: Address; symbol: string; decimals: number; chainId: number; explorer: string;
  prizes: PrizeRow[]; config: Record<PrizeCat, string[]>; minHold: string;
  closes: { week: number; at: number; by: string; winners: number; skipped: number }[];
}
const catLabel = (c: string) => tk(`cat.${c}`, c);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const err = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

/** El servidor puede tardar en ver el recibo: reintenta mientras diga "aún no" (404/425/502). */
async function reportPaid(id: number, txHash: string) {
  for (let i = 0; ; i++) {
    try { return await call('admin-paid', { id, txHash }); } catch (e) {
      if (i < 6 && e instanceof ApiError && [404, 425, 502].includes(e.status)) { await sleep(2500); continue; }
      throw e;
    }
  }
}

/**
 * Panel de premios, solo para admins. Pago MANUAL: el admin firma en su propia wallet; el servidor verifica en la red
 * que la transferencia salió de su wallet hacia el ganador y guarda el hash.
 */
export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useT();
  const [v, setV] = useState<AdminView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [manual, setManual] = useState<Record<number, string>>({});
  const [closeWk, setCloseWk] = useState('');

  const load = useCallback(async () => {
    try { const r = await call<AdminView>('admin'); setV(r); setCloseWk((w) => w || String(r.week - 1)); }
    catch (e) { setMsg({ ok: false, text: err(e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await load(); }
    catch (e) { setMsg({ ok: false, text: err(e) }); }
    finally { setBusy(null); }
  };

  const pay = (p: PrizeRow) => run(`pay-${p.id}`, async () => {
    if (!v || !p.wallet) throw new Error(t('admin.noWallet'));
    const conn = await connectForPayment();
    if (conn.address.toLowerCase() !== v.admin.toLowerCase()) {
      throw new Error(t('admin.switchWallet', { admin: shortAddr(v.admin), conn: shortAddr(conn.address) }));
    }
    const hash: Hash = await sendToken(conn, v.token, p.wallet as Address, parseUnits(p.amount, v.decimals));
    setMsg({ ok: true, text: t('admin.sentWaiting', { hash: hash.slice(0, 10) }) });
    const rc = await waitReceipt(hash);
    if (rc.status !== 'success') throw new Error(t('admin.txFailed'));
    await reportPaid(p.id, hash);
    return t('admin.paidMsg', { amount: p.amount, symbol: p.symbol, name: p.name });
  });

  const record = (p: PrizeRow) => run(`rec-${p.id}`, async () => {
    const h = (manual[p.id] ?? '').trim();
    await reportPaid(p.id, h);
    return t('admin.recorded', { name: p.name });
  });

  const weeks = v ? [...new Set(v.prizes.map((p) => p.week))] : [];
  return (
    <div className="pg-drawer pg-win pg-pn k-admin">
      <h3>{t('nav.admin')} <button className="x" onClick={onClose}>✕</button></h3>
      {!v && !msg && <p>{t('common.loading')}</p>}
      {msg && <div className={msg.ok ? 'pg-f-ok' : 'pg-f-err'}>{msg.text}</div>}
      {v && (
        <>
          <div className="pg-f-row">{t('admin.wallet')} <b>{shortAddr(v.admin)}</b> · {t('admin.week')} <b>{v.week}</b> {t('admin.ends', { date: new Date(v.weekEndsAt).toUTCString().slice(0, 22) })}</div>
          <div className="pg-f-row">{rich(t('admin.eligible', { min: v.minHold, symbol: v.symbol }))}</div>
          <div className="pg-f-actions">
            <input onKeyDown={(e) => e.stopPropagation()} className="pg-f-input" style={{ maxWidth: 110, flex: 'none' }} value={closeWk} onChange={(e) => setCloseWk(e.target.value.replace(/\D/g, ''))} aria-label={t('admin.weekToClose')} />
            <button className="pg-btn" disabled={!!busy} onClick={() => run('close', async () => {
              const r = await call<{ week: number; already?: boolean; winners?: number; skipped?: number }>('admin-close', { week: Number(closeWk) });
              return r.already ? t('admin.alreadyClosed', { w: r.week }) : t('admin.closed', { w: r.week, winners: r.winners ?? 0, skipped: r.skipped ?? 0 });
            })}>{t(busy === 'close' ? 'admin.closing' : 'admin.closeWeek')}</button>
            <button className="pg-btn" disabled={!!busy} onClick={() => run('gold', async () => {
              const r = await call<{ event: { line: string; endsAt: number } | null }>('admin-golden');
              return r.event ? t('admin.goldOn', { line: r.event.line, time: new Date(r.event.endsAt).toLocaleTimeString() }) : t('admin.goldActive');
            })}>{t(busy === 'gold' ? 'admin.starting' : 'admin.startGold')}</button>
          </div>
          <p><small>{t('admin.autoNote')}</small></p>

          {!weeks.length && <p>{t('admin.noPrizes')}</p>}
          {weeks.map((w) => (
            <div key={w}>
              <h4>{t('admin.weekN', { w })}</h4>
              <table className="pg-f-table">
                <thead><tr><th>{t('admin.prize')}</th><th>{t('admin.winner')}</th><th>{t('admin.amount')}</th><th>{t('admin.status')}</th><th /></tr></thead>
                <tbody>
                  {v.prizes.filter((p) => p.week === w).map((p) => (
                    <tr key={p.id}>
                      <td>{catLabel(p.category)} #{p.rank}<br /><small>{p.score} {tk(`admin.unit.${p.category}`, '')}</small></td>
                      <td>{p.name}<br /><code>{p.wallet ? shortAddr(p.wallet) : '—'}</code></td>
                      <td>{p.amount} {p.symbol}</td>
                      <td>
                        <span className={`pg-f-tag ${p.status}`}>{p.status}</span>
                        {p.txHash && <><br /><a href={`${v.explorer}/tx/${p.txHash}`} target="_blank" rel="noreferrer">tx ↗</a></>}
                      </td>
                      <td>
                        {p.status === 'pending' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button className="pg-btn" disabled={!!busy} onClick={() => pay(p)}>{t(busy === `pay-${p.id}` ? 'admin.paying' : 'admin.payNow')}</button>
                            <input onKeyDown={(e) => e.stopPropagation()} className="pg-f-input" style={{ minWidth: 0, fontSize: 11 }} placeholder={t('admin.pasteHash')}
                              value={manual[p.id] ?? ''} onChange={(e) => setManual({ ...manual, [p.id]: e.target.value })} />
                            {manual[p.id] && <button className="pg-btn" disabled={!!busy} onClick={() => record(p)}>{t('admin.recordHash')}</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {!!v.closes.length && (
            <p><small>{t('admin.closes', { list: v.closes.map((c) => t('admin.closeItem', { w: c.week, winners: c.winners, skipped: c.skipped, by: c.by === 'auto' ? 'auto' : shortAddr(c.by) })).join(' · ') })}</small></p>
          )}
        </>
      )}
    </div>
  );
};
