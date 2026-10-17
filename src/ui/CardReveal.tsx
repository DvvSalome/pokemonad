// Revelado de la carta coleccionable: al atrapar un monstruo (o al tocar una carta en la Caja) se dibuja su
// carta (cardCanvas.ts) con el retrato 3D (portrait.ts) y aparece dando la vuelta con un brillo foil que
// barre por encima. Es el "que salgan las cartas" del pedido. Lee la carta a mostrar desde captureStore.
import React, { useEffect, useState } from 'react';
import { useCapture, closeReveal, monSpecies, monFainted, monLook } from '../world/captureStore';
import { SPECIES_CATALOG } from '../world/species';
import { drawCard } from './cardCanvas';
import { portrait } from '../world/portrait';
import { getLang, useT } from '../i18n';
import { shareCard } from './share';

export const CardReveal: React.FC = () => {
  const cap = useCapture();
  const t = useT();
  const lang = getLang();
  const reveal = cap.reveal;
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    if (!reveal) { setImg(null); return; }
    let alive = true;
    setImg(null);
    const { mon } = reveal;
    const species = monSpecies(mon);
    if (!species) return;
    (async () => {
      const pic = await portrait(mon.model, monLook(mon)).catch(() => '');
      const cv = await drawCard({
        species, dexNo: reveal.dexNo, level: reveal.level, portrait: pic || undefined, shiny: reveal.shiny,
        total: SPECIES_CATALOG.length, token: mon.token, fainted: monFainted(mon),
      });
      if (alive) setImg(cv.toDataURL('image/png'));
    })();
    return () => { alive = false; };
  }, [reveal, lang]);

  if (!reveal) return null;
  const { mon } = reveal;
  const isNew = cap.result === 'caught';

  return (
    <div className="pg-reveal" onClick={closeReveal}>
      <div className="pg-reveal-in" onClick={(e) => e.stopPropagation()}>
        <div className={`pg-card-3d ${img ? 'in' : 'loading'}`}>
          {img ? (
            <div className="pg-card-face">
              <img src={img} alt={mon.name} draggable={false} />
              <span className="pg-card-shine" />
            </div>
          ) : (
            <div className="pg-card-skel"><span /></div>
          )}
        </div>
        <div className="pg-reveal-head">
          <span className={`pg-rar t-${mon.tier}`}>{mon.tier}</span>
          {t(isNew ? 'reveal.caught' : 'reveal.yours')}
        </div>
        <div className="pg-reveal-actions">
          <button className="pg-btn gold" onClick={closeReveal}>{t('reveal.keep')}</button>
          {img && <a className="pg-btn ghost small" href={img} download={`${mon.name}.png`}>{t('reveal.save')}</a>}
          {img && <button className="pg-btn ghost small" onClick={() => void shareCard(img, mon.name, mon.token?.symbol)}>{t('sh.share')}</button>}
        </div>
      </div>
    </div>
  );
};
