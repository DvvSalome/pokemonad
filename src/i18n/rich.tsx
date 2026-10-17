import React from 'react';

/** Pinta un texto traducido con `**negritas**` como <b>, sin HTML crudo. */
export function rich(s: string): React.ReactNode {
  const parts = s.split(/\*\*(.+?)\*\*/g);
  return parts.length === 1 ? s : parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <React.Fragment key={i}>{p}</React.Fragment>));
}
