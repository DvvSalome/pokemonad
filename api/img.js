// /api/img?u=<url>: reenvía el logo de un token con CORS abierto (los CDN de logos no lo mandan y sin él
// el juego no puede leer su paleta ni usarlo como textura). Solo https, solo imágenes, máx. 2 MB.
// En desarrollo lo sirve el middleware equivalente de vite.config.ts.
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x').searchParams.get('u') || '';
  if (!/^https:\/\//i.test(u)) return res.status(400).end();
  try {
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return res.status(413).end();
    res.setHeader('Content-Type', type);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(buf);
  } catch {
    return res.status(504).end();
  }
}
