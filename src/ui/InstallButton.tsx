import React, { useEffect, useState } from 'react';
import { t, useT } from '../i18n';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: PromptEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()); });
}

const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Instalar app" del menú: usa el aviso nativo del navegador; en iOS explica "Compartir → Añadir a inicio". */
export const InstallButton: React.FC = () => {
  useT();
  const [, bump] = useState(0);
  const [hint, setHint] = useState(false);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  if (standalone() || (!deferred && !isIOS())) return null;

  const install = async () => {
    if (!deferred) { setHint(true); return; }
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    bump((n) => n + 1);
  };
  return (
    <>
      <button className="pg-menu-item" onClick={() => void install()}>
        <span className="em">📲</span>{t('pwa.install')}
      </button>
      {hint && <p className="pg-mart-note">{t('pwa.iosHint')}</p>}
    </>
  );
};
