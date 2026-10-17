// El aspecto de un monstruo según su token, portado de research/pokegrass-source/js/{creature,toon,assets}.js:
// el cuerpo se repinta con los dos colores dominantes del logo, un shiny gira ese color de tono, y encima de
// la cabeza flota la moneda con el logo. Los logos se piden por /api/img (vite.config.ts): los CDN de logos
// no mandan CORS, y sin CORS el canvas queda "tainted" y ni se puede leer su paleta ni subirlo a WebGL.
import * as THREE from 'three';

export type Palette = [THREE.Color, THREE.Color];

export const imgUrl = (u: string, w = 192) => (u.startsWith('/') ? u : `/api/img?u=${encodeURIComponent(u)}&w=${w}`);

type Img = HTMLImageElement | HTMLCanvasElement;
const images = new Map<string, Promise<Img>>();

/** Logo del token; si no hay o no carga en 4.5 s, un círculo con sus iniciales (como el original). */
export function loadImage(u: string | undefined, label = '?'): Promise<Img> {
  const key = u || `letter:${label}`;
  const hit = images.get(key);
  if (hit) return hit;
  const p = new Promise<Img>((ok) => {
    if (!u) return ok(letterImage(label));
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    const tm = setTimeout(() => ok(letterImage(label)), 4500);
    im.onload = () => { clearTimeout(tm); ok(im); };
    im.onerror = () => { clearTimeout(tm); ok(letterImage(label)); };
    im.src = imgUrl(u);
  });
  images.set(key, p);
  return p;
}

export function letterImage(label: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const hue = [...String(label)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  g.fillStyle = `hsl(${hue} 60% 48%)`; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = "800 60px 'Baloo 2', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(label).replace(/^\$/, '').slice(0, 2).toUpperCase(), 64, 70);
  return c;
}

/** Los dos colores que mejor representan un logo: el dominante y el primero que se distingue de él. */
export function paletteOf(img: Img): Palette | null {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  let px: Uint8ClampedArray;
  try { g.drawImage(img, 0, 0, 32, 32); px = g.getImageData(0, 0, 32, 32).data; } catch { return null; }
  type Bucket = { cnt: number; w: number; r: number; g: number; b: number };
  const buckets = new Map<string, Bucket>();
  const hsl = { h: 0, s: 0, l: 0 };
  const tmp = new THREE.Color();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    tmp.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
    if (hsl.l > 0.92 || hsl.l < 0.07) continue; // fondos blancos/negros y contornos no dicen nada del token
    const key = `${Math.round(hsl.h * 18) % 18}-${Math.round(hsl.s * 3)}-${Math.round(hsl.l * 4)}`;
    const e = buckets.get(key) || { cnt: 0, w: 0, r: 0, g: 0, b: 0 };
    e.cnt++; e.w += 1 + hsl.s * 1.5; e.r += r; e.g += gg; e.b += b;
    buckets.set(key, e);
  }
  const list = [...buckets.values()].sort((a, b) => b.w - a.w);
  if (!list.length) return null;
  const colorOf = (e: Bucket) => new THREE.Color().setRGB(e.r / e.cnt / 255, e.g / e.cnt / 255, e.b / e.cnt / 255, THREE.SRGBColorSpace);
  const hslOf = (e: Bucket) => { const h = { h: 0, s: 0, l: 0 }; colorOf(e).getHSL(h, THREE.SRGBColorSpace); return h; };
  const m = hslOf(list[0]);
  const second = list.slice(1).find((e) => {
    const h = hslOf(e);
    const dh = Math.min(Math.abs(h.h - m.h), 1 - Math.abs(h.h - m.h));
    return dh > 0.08 || Math.abs(h.l - m.l) > 0.22;
  }) || list[1] || list[0];
  // un monstruo se lee mejor algo más saturado y nunca demasiado oscuro ni lavado
  const finish = (e: Bucket, sec = false) => {
    const h = hslOf(e);
    return new THREE.Color().setHSL(h.h, Math.min(1, h.s * 1.12 + 0.04), Math.max(sec ? 0.4 : 0.34, Math.min(0.7, h.l)), THREE.SRGBColorSpace);
  };
  return [finish(list[0]), finish(second, true)];
}

const palettes = new Map<string, Promise<Palette | null>>();
/** Paleta del token (cacheada por logo o símbolo). */
export function paletteFor(logo: string | undefined, symbol: string): Promise<Palette | null> {
  const key = logo || symbol;
  let p = palettes.get(key);
  if (!p) { p = loadImage(logo, symbol).then(paletteOf); palettes.set(key, p); }
  return p;
}

/** Shiny: la misma paleta con el tono girado y algo más viva. */
export function shinyColor(c: THREE.Color): THREE.Color {
  const h = { h: 0, s: 0, l: 0 }; c.getHSL(h);
  return new THREE.Color().setHSL((h.h + 0.47) % 1, Math.min(1, h.s + 0.15), Math.min(0.75, h.l + 0.08));
}
export const shinyPalette = (p: Palette): Palette => [shinyColor(p[0]), shinyColor(p[1])];

/** Partes que conservan su color propio (ojos, dientes, oro, armas…) y partes que llevan el color secundario. */
const KEEP = /Eye|Teeth|Tongue|Mouth|Gold|Belt|Weapon|Trident|Wood|Straps|Black|Beak|Carrot|Material\./i;
const SECOND = /Secondary|Flaps|Ears|Horn|Wings|Hair|Red\b|_Red/i;

/**
 * Repinta un monstruo ya toonificado con la paleta. Guarda el color original de cada material en userData
 * para poder volver a él (p. ej. cuando se acaba el Shiny Charm y el ejemplar deja de ser shiny).
 */
export function applyPalette(root: THREE.Object3D, pal: Palette | null) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.isOutline) return;
    for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshToonMaterial[]) {
      if (!mat.color || KEEP.test(mat.name)) continue;
      const orig: THREE.Color = mat.userData.origColor ?? (mat.userData.origColor = mat.color.clone());
      const want = !pal ? orig : SECOND.test(mat.name) ? pal[1] : /Main/i.test(mat.name) ? pal[0] : orig;
      mat.color.copy(want);
    }
  });
}

/** Paleta de los colores propios del modelo (para el shiny de un monstruo sin token). */
export function naturalPalette(root: THREE.Object3D): Palette | null {
  let main: THREE.Color | null = null, second: THREE.Color | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.isOutline) return;
    for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshToonMaterial[]) {
      if (!mat.color || KEEP.test(mat.name)) continue;
      const c = (mat.userData.origColor as THREE.Color | undefined) ?? mat.color;
      if (!second && SECOND.test(mat.name)) second = c.clone();
      else if (!main && /Main/i.test(mat.name)) main = c.clone();
    }
  });
  if (!main) return null;
  return [main, second ?? (main as THREE.Color).clone()];
}

const logoTex = new Map<string, Promise<THREE.CanvasTexture>>();
/** Textura redonda del logo con borde, para la cara de la moneda. */
export function logoTexture(u: string | undefined, label: string, ring = '#ffffff'): Promise<THREE.CanvasTexture> {
  const key = `${u || label}|${ring}`;
  let p = logoTex.get(key);
  if (!p) {
    p = loadImage(u, label).then((im) => {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d')!;
      g.fillStyle = ring; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
      g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 14, 0, Math.PI * 2); g.clip();
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      const iw = (im as HTMLImageElement).naturalWidth || im.width, ih = (im as HTMLImageElement).naturalHeight || im.height;
      const k = Math.max((S - 28) / iw, (S - 28) / ih);
      g.drawImage(im, S / 2 - (iw * k) / 2, S / 2 - (ih * k) / 2, iw * k, ih * k);
      g.restore();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      return t;
    });
    logoTex.set(key, p);
  }
  return p;
}

let _ring: THREE.CanvasTexture | null = null, _dot: THREE.CanvasTexture | null = null;
export function ringTexture(): THREE.CanvasTexture {
  if (_ring) return _ring;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return (_ring = new THREE.CanvasTexture(c));
}
export function dotTexture(): THREE.CanvasTexture {
  if (_dot) return _dot;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_dot = new THREE.CanvasTexture(c));
}
