// Tienda de bolas y la lección del profesor. La lección solo aparece después de capturarlo.
import React, { useState } from 'react';
import { addBalls, startEncounter, useCapture } from '../world/captureStore';
import { addBuff } from '../world/buffs';
import { spawnById } from '../world/wildStore';
import { t, useT } from '../i18n';

const COIN_KEY = 'pg-field-coins';
const START_COINS = 200;

function readCoins(): number {
  try {
    const raw = localStorage.getItem(COIN_KEY);
    if (raw == null) return START_COINS;
    const n = Number(raw);
    return Number.isFinite(n) ? n : START_COINS;
  } catch { return START_COINS; }
}

const GOODS = [
  { id: 'grass', name: '10 Grass Balls', cost: 40, balls: { ball: 10 } as const },
  { id: 'super', name: '5 Super Balls', cost: 80, balls: { super: 5 } as const },
  { id: 'hyper', name: '3 Hyper Balls', cost: 120, balls: { hyper: 3 } as const },
  { id: 'hood', name: 'Hood Ball', cost: 200, balls: { hood: 1 } as const },
] as const;

export const FieldShop: React.FC = () => {
  useT();
  const cap = useCapture();
  const [open, setOpen] = useState(false);
  const [coins, setCoins] = useState(readCoins);
  const [note, setNote] = useState('');
  const spend = (cost: number, give: () => void, name: string) => {
    if (coins < cost) { setNote(t('shop.poor')); return; }
    const next = coins - cost;
    setCoins(next);
    try { localStorage.setItem(COIN_KEY, String(next)); } catch { /* vale en memoria */ }
    give();
    setNote(t('shop.got', { name }));
  };
  if (cap.activeId) return null;
  return (
    <>
      <button className="ex-shop-btn" onClick={() => { setOpen(true); setNote(''); }}>{t('shop.open')}</button>
      {open && (
        <div className="ex-shop-back" onClick={() => setOpen(false)}>
          <div className="ex-shop" onClick={(e) => e.stopPropagation()}>
            <header>
              <b>{t('shop.title')}</b>
              <span>{coins} {t('shop.coins')}</span>
              <button onClick={() => setOpen(false)} aria-label={t('common.close')}>✕</button>
            </header>
            <p>{t('shop.hint')}</p>
            <ul>
              {GOODS.map((g) => (
                <li key={g.id}>
                  <span>{g.name}</span>
                  <button disabled={coins < g.cost} onClick={() => spend(g.cost, () => addBalls({ ...g.balls }), g.name)}>{g.cost}</button>
                </li>
              ))}
              <li>
                <span>{t('shop.radar')}</span>
                <button disabled={coins < 60} onClick={() => spend(60, () => addBuff('radar', 20), t('shop.radar'))}>60</button>
              </li>
            </ul>
            {note && <small>{note}</small>}
          </div>
        </div>
      )}
    </>
  );
};

export const CatchPrompt: React.FC = () => {
  const cap = useCapture();
  useT();
  const near = cap.nearbyId && !cap.activeId ? spawnById(cap.nearbyId) : undefined;
  if (!near) return null;
  return (
    <button className="ex-invite" onClick={() => startEncounter(near.id)}>
      <kbd>E</kbd> {t('shop.ask')} <b>{near.species.name}</b>
    </button>
  );
};
