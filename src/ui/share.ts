// Compartir una carta en X, como el share del original: con la hoja de compartir del sistema si deja adjuntar la
// imagen (móvil); si no, se descarga la carta y se abre un post de X con el texto y tu enlace de invitación.
import { getOnline, inviteLink } from '../world/online';
import { t } from '../i18n';

export async function shareCard(dataUrl: string, name: string, symbol?: string) {
  const code = getOnline().trainer?.refCode;
  const url = code ? inviteLink(code) : location.origin;
  const text = t(symbol ? 'sh.textToken' : 'sh.text', { name, symbol: symbol ?? '' });
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `${name}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, url }); return; }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = dataUrl; a.download = `${name}.png`; a.click();
  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
}
