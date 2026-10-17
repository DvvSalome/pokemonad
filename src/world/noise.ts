// Ruido determinista y utilidades matemáticas compartidas por el terreno, el spawn de props y
// (más adelante) el mapeo token→especie. Puro, sin dependencias — igual que en pokegrass-source/lib/species.js.

/** Hash 32-bit determinista de un string (FNV-1a). Misma dirección de contrato → mismo resultado siempre. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** PRNG determinista sembrado (mulberry32). Misma semilla → misma secuencia siempre. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed = 1) {
  const R = rng(seed);
  const P = new Float32Array(512);
  for (let i = 0; i < 512; i++) P[i] = R();
  const h = (x: number, y: number) => P[((x * 73856093) ^ (y * 19349663)) & 511];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export const n1 = valueNoise(7);
export const n2 = valueNoise(21);
export const n3 = valueNoise(99);
export const fbm = (x: number, y: number) => n1(x, y) * 0.55 + n1(x * 2.1, y * 2.1) * 0.28 + n1(x * 4.3, y * 4.3) * 0.17;

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
