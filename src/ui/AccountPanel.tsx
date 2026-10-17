import React, { useState } from 'react';
import { createRecoveryKey, inviteLink, recoverAccount, redeemInvite, useOnline } from '../world/online';
import { useWallet, connect } from '../world/walletStore';
import { t as tr, useT } from '../i18n';
import { rich } from '../i18n/rich';
import './polish/panels.css';

/**
 * Cuenta: cómo no perder la partida. Un invitado vive en este navegador; con una clave de recuperación (o la
 * wallet) se puede volver a entrar desde otro dispositivo, como en el original.
 */
export const AccountPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useT();
  const online = useOnline();
  const wallet = useWallet();
  const t = online.trainer;
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const make = async () => {
    if (t?.hasRecovery && !confirm(tr('acc.confirmReplace'))) return;
    setBusy(true); setErr(null);
    try { setKey(await createRecoveryKey()); setCopied(false); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const copy = async () => {
    if (!key) return;
    try { await navigator.clipboard.writeText(key); setCopied(true); } catch { /* sin portapapeles: el jugador la copia a mano */ }
  };
  const restore = async () => {
    const unsaved = t && !t.wallet && !t.hasRecovery && (t.stats.catches ?? 0) > 0;
    if (unsaved && !confirm(tr('acc.confirmSwitch'))) return;
    setBusy(true); setErr(null);
    const e = await recoverAccount(input);
    if (e) { setErr(e); setBusy(false); }
  };

  return (
    <div className="pg-drawer pg-win pg-pn pg-account k-account">
      <h3>{tr('acc.title')} <button className="x" onClick={onClose}>✕</button></h3>
      {!t ? (
        <p className="pg-mart-note">{tr(online.status === 'connecting' ? 'common.connecting' : 'acc.offline')}</p>
      ) : (
        <>
          <div className={`pg-acc-row ${t.wallet ? 'is-wallet' : 'is-guest'}`}>
            <span className="pg-acc-ic" aria-hidden>{t.wallet ? '🔗' : '👤'}</span>
            <span className="pg-acc-kind">{tr(t.wallet ? 'acc.walletKind' : 'acc.guestKind')}</span>
            <b>{t.name}</b>
            <span className={`pg-acc-safe ${t.wallet || t.hasRecovery ? 'ok' : 'warn'}`}>
              {tr(t.wallet || t.hasRecovery ? 'acc.protected' : 'acc.deviceOnly')}
            </span>
          </div>

          <h4 className="pg-sub">{tr('acc.recovery')}</h4>
          <p className="pg-mart-note">
            {tr('acc.recoveryNote')}
          </p>
          {key ? (
            <div className="pg-acc-key">
              <code>{key}</code>
              <button className="pg-btn small" onClick={() => void copy()}>{tr(copied ? 'common.copied' : 'common.copy')}</button>
              <p className="pg-mart-note">{rich(tr('acc.writeDown'))}</p>
            </div>
          ) : (
            <button className="pg-btn small" disabled={busy} onClick={() => void make()}>
              {tr(t.hasRecovery ? 'acc.newKey' : 'acc.createKey')}
            </button>
          )}

          {!t.wallet && (
            <>
              <h4 className="pg-sub">{tr('acc.wallet')}</h4>
              <p className="pg-mart-note">{tr('acc.walletNote')}</p>
              <button className="pg-btn small ghost" disabled={wallet.status === 'connecting'} onClick={() => void connect()}>{tr('common.connectWallet')}</button>
            </>
          )}

          {t.refCode && (
            <>
              <h4 className="pg-sub">{tr('acc.invite')}</h4>
              <p className="pg-mart-note">
                {tr('acc.inviteNote')}
                {t.refs ? <> {rich(tr('acc.joined', { n: t.refs }))}</> : null}
              </p>
              <div className="pg-acc-key">
                <code>{t.refCode}</code>
                <button className="pg-btn small" onClick={() => {
                  navigator.clipboard?.writeText(inviteLink(t.refCode!)).then(() => setLinkCopied(true), () => { /* sin portapapeles */ });
                }}>{tr(linkCopied ? 'acc.linkCopied' : 'acc.copyLink')}</button>
              </div>
              {!t.referred && (
                <form className="pg-rename" onSubmit={(e) => {
                  e.preventDefault(); setBusy(true); setCodeErr(null);
                  void redeemInvite(code).then((er) => { setCodeErr(er); setBusy(false); if (!er) setCode(''); });
                }}>
                  <input placeholder={tr('acc.friendCode')} value={code} maxLength={16} spellCheck={false} autoComplete="off"
                    onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                  <button className="pg-btn small" type="submit" disabled={busy || code.trim().length < 4}>{tr('acc.redeem')}</button>
                </form>
              )}
              {codeErr && <p className="pg-mart-note pg-acc-err">{codeErr}</p>}
            </>
          )}

          <h4 className="pg-sub">{tr('acc.otherDevice')}</h4>
          <form className="pg-rename" onSubmit={(e) => { e.preventDefault(); void restore(); }}>
            <input
              placeholder="PG-XXXXX-XXXXX-XXXXX-XXXXX" value={input} maxLength={40} spellCheck={false} autoComplete="off"
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
            />
            <button className="pg-btn small" type="submit" disabled={busy || input.replace(/[^a-z0-9]/gi, '').length < 20}>{tr('acc.recover')}</button>
          </form>
          {err && <p className="pg-mart-note pg-acc-err">{err}</p>}
        </>
      )}
    </div>
  );
};
