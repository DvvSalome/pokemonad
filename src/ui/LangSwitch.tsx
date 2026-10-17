import React from 'react';
import { LANGS, setLang, useLang, useT } from '../i18n';
import './i18n.css';

/** Selector de idioma (EN/ES…): píldora oscura en la portada, clara dentro del menú. */
export const LangSwitch: React.FC<{ tone?: 'dark' | 'light' }> = ({ tone = 'dark' }) => {
  const lang = useLang();
  const t = useT();
  return (
    <div className={`pg-lang ${tone}`} role="group" aria-label={t('common.language')}>
      {tone === 'light' && <span className="pg-lang-lbl">🌐 {t('common.language')}</span>}
      <div className="pg-lang-opts">
        {LANGS.map((l) => (
          <button
            key={l.code}
            className={lang === l.code ? 'on' : ''}
            aria-pressed={lang === l.code}
            title={l.name}
            lang={l.code}
            onClick={(e) => { e.stopPropagation(); setLang(l.code); }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
};
