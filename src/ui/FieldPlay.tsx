// Invitación a hablar con el profesor más cercano.
import React from 'react';
import { startEncounter, useCapture } from '../world/captureStore';
import { spawnById } from '../world/wildStore';
import { t, useT } from '../i18n';

// La tienda pasó a PlayerHub.tsx (Poké Mart) y las monedas a world/progressStore.ts.

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
