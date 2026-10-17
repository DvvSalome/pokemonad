import React, { useEffect, useState } from 'react';
import { recoverAccount, retryOnline, useOnline } from '../world/online';
import { useT } from '../i18n';
import './rateLimit.css';
import './polish/panels.css';

/**
 * Aviso no bloqueante cuando el servidor frena la entrada (demasiados invitados nuevos desde la misma red): se juega
 * en local, se reintenta solo al acabar la espera y, si el jugador ya tiene clave de recuperación, puede entrar con ella.
 */
export const RateLimitNotice: React.FC = () => {
  const t = useT();
  const online = useOnline();
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lim = online.limited;

  useEffect(() => {
    if (!lim) return;
    setHidden(false);
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [lim]);

  if (!lim || online.status === 'online' || hidden) return null;
  const left = Math.max(0, Math.ceil((lim.retryAt - now) / 1000));
  const time = left >= 60 ? t('limit.min', { n: Math.ceil(left / 60) }) : t('limit.sec', { n: left });
  const retrying = online.status === 'connecting';

  const submitKey = async () => {
    setBusy(true); setErr(null);
    const e = await recoverAccount(input);
    if (e) { setErr(e); setBusy(false); }
  };

  return (
    <div className="pg-limit" role="status" aria-live="polite">
      <div className="pg-limit-head">
        <b>{t('limit.title')}</b>
        <button className="pg-limit-x" onClick={() => setHidden(true)} title={t('limit.hide')} aria-label={t('limit.hide')}>✕</button>
      </div>
      <p>{t(lim.guest ? 'limit.guest' : 'limit.other', { time })}</p>
      <div className="pg-limit-row">
        <button className="pg-btn small" disabled={retrying} onClick={() => { void retryOnline(); }}>
          {t(retrying ? 'limit.retrying' : 'limit.retry')}
        </button>
        {lim.guest && !keyOpen && (
          <button className="pg-limit-link" onClick={() => setKeyOpen(true)}>{t('limit.haveKey')}</button>
        )}
      </div>
      {lim.guest && keyOpen && (
        <form className="pg-limit-row" onSubmit={(e) => { e.preventDefault(); void submitKey(); }}>
          <input
            placeholder="PG-XXXXX-XXXXX-XXXXX-XXXXX" value={input} maxLength={40} spellCheck={false} autoComplete="off"
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
          />
          <button className="pg-btn small" type="submit" disabled={busy || input.replace(/[^a-z0-9]/gi, '').length < 20}>
            {t('limit.useKey')}
          </button>
        </form>
      )}
      {err && <p className="pg-limit-err">{err}</p>}
    </div>
  );
};
