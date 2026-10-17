// Mantiene el juego al día con Arc mientras se juega: la cuenta en el servidor (online.ts), el feed de
// salvajes (wildStore) y el market cap de los tokens ya atrapados, que es lo que sube de nivel (o debilita)
// a los monstruos de la colección. Con servidor ese market cap llega en su partida (lo refresca su tick);
// sin conexión se pide directo a DexScreener.
import { fetchArcTokens } from '../../lib/arc/tokens';
import { isOnline } from '../../lib/api';
import { startWildFeed, stopWildFeed } from './wildStore';
import { getCollection, updateCollectionCaps } from './captureStore';
import { bootOnline } from './online';

async function syncCollection() {
  if (isOnline()) return;
  const addrs = [...new Set(getCollection().flatMap((m) => (m.token ? [m.token.address] : [])))];
  const caps = new Map<string, number>();
  // DexScreener acepta hasta 30 direcciones por llamada.
  for (let i = 0; i < addrs.length; i += 30) {
    try {
      for (const t of await fetchArcTokens(addrs.slice(i, i + 30))) if (t.marketCap > 0) caps.set(t.address, t.marketCap);
    } catch { /* sin red: se conserva el último market cap conocido */ }
  }
  if (caps.size) updateCollectionCaps(caps);
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startArcSync() {
  // El feed arranca tras la sesión, para que su primera carga ya venga del servidor si está disponible.
  void bootOnline().finally(startWildFeed);
  if (timer) return;
  void syncCollection();
  timer = setInterval(() => { void syncCollection(); }, 120_000);
}
export function stopArcSync() {
  stopWildFeed();
  if (timer) clearInterval(timer);
  timer = null;
}
