import React, { useState } from 'react';
import './features.css';
import './polish/panels.css';
import { t, useT, type Key } from '../i18n';

export type LegalDoc = 'terms' | 'privacy' | 'prizes' | 'risk';
const TABS: { k: LegalDoc; label: Key }[] = [
  { k: 'terms', label: 'legal.tab.terms' }, { k: 'privacy', label: 'legal.tab.privacy' }, { k: 'prizes', label: 'legal.tab.prizes' }, { k: 'risk', label: 'legal.tab.risk' },
];

/**
 * Legal mínimo. BORRADOR: hay que revisarlo con un abogado antes de pagar premios con dinero real (según el país, un
 * premio en cripto puede contar como sorteo o apuesta).
 */
export const LegalPanel: React.FC<{ onClose: () => void; initial?: LegalDoc }> = ({ onClose, initial = 'terms' }) => {
  const [tab, setTab] = useState<LegalDoc>(initial);
  useT();
  return (
    <div className="pg-drawer pg-win pg-pn k-legal">
      <h3>{t('nav.legal')} <button className="x" onClick={onClose}>✕</button></h3>
      <div className="pg-f-tabs">
        {TABS.map((x) => <button key={x.k} className={tab === x.k ? 'on' : ''} onClick={() => setTab(x.k)}>{t(x.label)}</button>)}
      </div>
      <div className="pg-legal">
        <p className="draft">{t('legal.draft')}</p>
        {tab === 'terms' && <Terms />}
        {tab === 'privacy' && <Privacy />}
        {tab === 'prizes' && <Prizes />}
        {tab === 'risk' && <Risk />}
        <p><small>{t('legal.updated', { date: t('legal.date') })}</small></p>
      </div>
    </div>
  );
};

const H: React.FC<{ k: Key }> = ({ k }) => <h4>{t(k)}</h4>;
const P: React.FC<{ k: Key }> = ({ k }) => <p>{t(k)}</p>;
const L: React.FC<{ ks: Key[] }> = ({ ks }) => <ul>{ks.map((k) => <li key={k}>{t(k)}</li>)}</ul>;

const Terms = () => (
  <>
    {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
      <React.Fragment key={n}><H k={`legal.terms.h${n}`} /><P k={`legal.terms.p${n}`} /></React.Fragment>
    ))}
  </>
);

const Privacy = () => (
  <>
    <H k="legal.privacy.h1" />
    <L ks={['legal.privacy.li1', 'legal.privacy.li2', 'legal.privacy.li3', 'legal.privacy.li4']} />
    <H k="legal.privacy.h2" /><P k="legal.privacy.p2" />
    <H k="legal.privacy.h3" /><P k="legal.privacy.p3" />
    <H k="legal.privacy.h4" /><P k="legal.privacy.p4" />
  </>
);

const Prizes = () => (
  <>
    <H k="legal.prizes.h1" /><P k="legal.prizes.p1" /><P k="legal.prizes.p1b" />
    <H k="legal.prizes.h2" /><P k="legal.prizes.p2" />
    <H k="legal.prizes.h3" />
    <L ks={['legal.prizes.li1', 'legal.prizes.li2', 'legal.prizes.li3', 'legal.prizes.li4', 'legal.prizes.li5']} />
  </>
);

const Risk = () => (
  <>
    <H k="legal.risk.h1" /><P k="legal.risk.p1" /><P k="legal.risk.p2" /><P k="legal.risk.p3" />
  </>
);
