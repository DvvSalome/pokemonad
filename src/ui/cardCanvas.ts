// Carta coleccionable vertical estilo Pokémon (ratio ~2.5:3.5), tamaño grande 900×1260.
// Anatomía clásica (HP, arte, ataques, debilidad) con identidad PokeMonad: marco Arc azul/oro,
// nunca amarillo cartón. Título $SYMBOL si hay token. Legendarios en face medianoche.
import { TYPE_COLORS, type MonType, type Tier, type Species } from '../world/species';
import { fighter, MOVE_NAME, weakTo, resists } from '../world/battleMath';
import { getLang, t as tr, tk } from '../i18n';

export const CW = 900, CH = 1260;

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

const ZONE_LABEL: Record<string, string> = {
  meadow: 'Route 1 Meadow', lake: 'Crystal Lake', woods: 'Whisper Woods', volcano: 'Ember Crater', peak: 'Frost Peak', ruins: 'Sunstone Ruins',
};

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const hx = (c: string) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: string, b: string, k: number) => { const A = hx(a), B = hx(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; };
const dark = (c: string, k = 0.35) => mix(c, '#000000', k), light = (c: string, k = 0.35) => mix(c, '#ffffff', k);
const fit = (g: CanvasRenderingContext2D, text: string, max: number) => { let t = text; while (g.measureText(t).width > max && t.length > 3) t = t.slice(0, -2) + '…'; return t; };
const FOIL: Record<Tier, number> = { Common: 0, Uncommon: 0.35, Rare: 0.7, Epic: 0.9, Legendary: 1 };
export const RARITY_SYM: Record<Tier, string> = { Common: '●', Uncommon: '◆', Rare: '★', Epic: '★★', Legendary: '★★★' };

function holo(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, strength: number, t = 0, radius = 18) {
  if (strength <= 0) return;
  g.save(); rr(g, x, y, w, h, radius); g.clip();
  const off = (t % 1) * (w + h);
  for (let i = -2; i < 4; i++) {
    const p = i * (w + h) * 0.3 + off - (w + h) * 0.4;
    const gr = g.createLinearGradient(x + p, y, x + p + h * 0.7, y + h);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.3, `rgba(120,200,255,${0.2 * strength})`);
    gr.addColorStop(0.45, `rgba(180,230,255,${0.26 * strength})`);
    gr.addColorStop(0.6, `rgba(255,220,140,${0.16 * strength})`);
    gr.addColorStop(0.75, `rgba(140,180,255,${0.12 * strength})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  }
  g.restore();
}
function glitter(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n: number, seed: number) {
  let s = seed >>> 0; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const px = x + R() * w, py = y + R() * h, r = 0.8 + R() * 2;
    g.fillStyle = `rgba(255,255,255,${0.3 + R() * 0.55})`;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }
}
function brushed(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  g.save(); rr(g, x, y, w, h, 26); g.clip();
  g.fillStyle = col; g.fillRect(x, y, w, h);
  const band = g.createLinearGradient(x, 0, x + w, 0);
  band.addColorStop(0, 'rgba(255,255,255,0.05)'); band.addColorStop(0.5, 'rgba(255,255,255,0.2)'); band.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = band; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.04)'; g.lineWidth = 1;
  for (let i = -h; i < w + h; i += 7) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i - h, y + h); g.stroke(); }
  g.restore();
}
function bevel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, gold: boolean) {
  const c1 = gold ? '#fff1b0' : '#f0f6ff', c2 = gold ? '#c99a2e' : '#7a9fd4', c3 = gold ? '#7a5a12' : '#2a4a7a';
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, c1); gr.addColorStop(0.35, c2); gr.addColorStop(0.6, c1); gr.addColorStop(1, c3);
  g.fillStyle = gr; rr(g, x, y, w, h, r); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; rr(g, x + 1, y + 1, w - 2, h - 2, r); g.stroke();
}
function energy(g: CanvasRenderingContext2D, x: number, y: number, r: number, type: MonType) {
  const col = TYPE_COLORS[type] || '#a8a77a';
  g.fillStyle = dark(col, 0.35); g.beginPath(); g.arc(x, y, r + 2, 0, Math.PI * 2); g.fill();
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  gr.addColorStop(0, light(col, 0.45)); gr.addColorStop(1, col);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = `800 ${Math.round(r * 1.25)}px 'Baloo 2', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(type[0], x, y + 1); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, no) => {
  const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src;
});
async function fonts() {
  await Promise.all([
    "800 52px 'Baloo 2'", "800 36px 'Baloo 2'", "700 22px 'Nunito'", "800 18px 'Nunito'", "italic 600 17px 'Nunito'",
  ].map((f) => (document as any).fonts?.load(f).catch(() => null)));
}

export interface CardData {
  species: Species;
  dexNo: number;
  level: number;
  portrait?: string;
  trainer?: string;
  total?: number;
  shiny?: boolean;
  token?: { address: string; symbol: string; marketCap: number; logo?: string };
  fainted?: boolean;
}

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);

/** Carta vertical estilo Pokémon · PokeMonad. `t` = fase foil. */
export async function drawCard(c: CardData, { t = 0 }: { t?: number } = {}): Promise<HTMLCanvasElement> {
  await fonts();
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
  const g = cv.getContext('2d')!;
  const sp = c.species;
  const type = sp.type, col = TYPE_COLORS[type] || '#a8a77a';
  const rar = sp.tier, foil = FOIL[rar] + (c.shiny ? 0.35 : 0);
  const L = rar === 'Legendary';
  const gold = rar === 'Epic' || L;
  const level = c.level || 5, f = fighter(sp.id, level);
  const zone = tk(`card.zone.${sp.zone}`, ZONE_LABEL[sp.zone] || 'PokeMonad');
  const seed = hash32(sp.id + '|poke-v5');
  const title = c.token ? `$${c.token.symbol}` : sp.name;
  const pal = L
    ? { ink: '#fff6d8', sub: '#c9b88a', box: 'rgba(255,215,120,0.12)', line: 'rgba(255,215,120,0.22)', hp: '#ff8a80', dmg: '#fff6d8' }
    : { ink: '#15233b', sub: '#3a5577', box: 'rgba(255,255,255,0.55)', line: 'rgba(20,45,90,0.18)', hp: '#b71c1c', dmg: '#15233b' };

  // —— marco exterior (Arc: azul/plata u oro, NUNCA amarillo Pokémon) ——
  g.fillStyle = L ? '#1a1204' : '#0a1a3a';
  rr(g, 0, 0, CW, CH, 40); g.fill();
  const bg = g.createLinearGradient(0, 0, CW, CH);
  if (gold) {
    bg.addColorStop(0, '#fff3c8'); bg.addColorStop(0.3, '#e0b84a'); bg.addColorStop(0.6, '#f5e09a'); bg.addColorStop(1, '#b88828');
  } else if (rar === 'Rare') {
    bg.addColorStop(0, '#dceeff'); bg.addColorStop(0.45, '#6aa8f0'); bg.addColorStop(1, '#2f6bc0');
  } else {
    bg.addColorStop(0, '#eef4fc'); bg.addColorStop(0.4, '#a8c4e8'); bg.addColorStop(0.75, '#6a8fc4'); bg.addColorStop(1, '#3a5a90');
  }
  g.fillStyle = bg; rr(g, 5, 5, CW - 10, CH - 10, 36); g.fill();
  if (c.shiny) holo(g, 5, 5, CW - 10, CH - 10, 0.9, t + 0.5, 36);
  g.strokeStyle = gold ? 'rgba(90,60,10,0.35)' : 'rgba(14,41,111,0.35)';
  g.lineWidth = 2.5; rr(g, 36, 36, CW - 72, CH - 72, 26); g.stroke();

  // —— cara ——
  const fx = 38, fy = 38, fw = CW - 76, fh = CH - 76;
  if (L) {
    g.fillStyle = '#080a12'; rr(g, 28, 28, CW - 56, CH - 56, 30); g.fill();
    brushed(g, fx, fy, fw, fh, '#12182a');
    const glow = g.createRadialGradient(CW / 2, 420, 40, CW / 2, 420, 700);
    glow.addColorStop(0, 'rgba(72,163,244,0.28)'); glow.addColorStop(0.45, 'rgba(255,196,80,0.1)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); rr(g, fx, fy, fw, fh, 26); g.clip(); g.fillStyle = glow; g.fillRect(fx, fy, fw, fh); g.restore();
    g.strokeStyle = 'rgba(255,215,120,0.75)'; g.lineWidth = 2.5; rr(g, fx + 7, fy + 7, fw - 14, fh - 14, 20); g.stroke();
    g.strokeStyle = 'rgba(72,163,244,0.35)'; g.lineWidth = 1; rr(g, fx + 14, fy + 14, fw - 28, fh - 28, 16); g.stroke();
    g.fillStyle = '#ffd76a';
    for (const [px, py] of [[fx + 30, fy + 30], [fx + fw - 30, fy + 30], [fx + 30, fy + fh - 30], [fx + fw - 30, fy + fh - 30]] as const) {
      g.beginPath(); g.moveTo(px, py - 10); g.lineTo(px + 10, py); g.lineTo(px, py + 10); g.lineTo(px - 10, py); g.closePath(); g.fill();
    }
    holo(g, fx, fy, fw, fh, 0.5 + (c.shiny ? 0.25 : 0), t, 26);
  } else {
    brushed(g, fx, fy, fw, fh, light(col, 0.12));
    if (c.shiny) holo(g, fx, fy, fw, fh, 0.75, t, 26);
  }

  // —— cabecera ——
  g.textAlign = 'left';
  if (L) {
    const rb = g.createLinearGradient(70, 0, 340, 0);
    rb.addColorStop(0, '#ffe9a8'); rb.addColorStop(0.5, '#e2b64a'); rb.addColorStop(1, '#b8881f');
    g.fillStyle = rb; rr(g, 70, 66, 230, 32, 16); g.fill();
    g.fillStyle = '#2a1c04'; g.font = "800 18px 'Nunito', sans-serif"; g.fillText(tr('card.legendary'), 88, 88);
  } else {
    g.fillStyle = pal.ink; g.font = "700 22px 'Nunito', sans-serif"; g.fillText(tr('card.basic'), 70, 88);
  }
  g.font = "800 52px 'Baloo 2', sans-serif";
  if (L) {
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeText(fit(g, title, 480), 70, 152);
    const nm = g.createLinearGradient(0, 112, 0, 156);
    nm.addColorStop(0, '#fff3c4'); nm.addColorStop(0.55, '#f2c650'); nm.addColorStop(1, '#c28d1c');
    g.fillStyle = nm;
  } else g.fillStyle = pal.ink;
  g.fillText(fit(g, title, 480), 70, 152);
  g.textAlign = 'right'; g.font = "800 46px 'Baloo 2', sans-serif"; g.fillStyle = pal.hp;
  if (L) { g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeText(`HP ${f.maxHp}`, CW - 130, 144); }
  g.fillText(`HP ${f.maxHp}`, CW - 130, 144);
  g.textAlign = 'left';
  energy(g, CW - 92, 128, 30, type);

  // —— marco del arte ——
  const ax = 74, ay = 178, aw = CW - 148, ah = 500;
  bevel(g, ax - 10, ay - 10, aw + 20, ah + 20, 16, gold || rar === 'Rare');
  if (L) {
    const night = g.createRadialGradient(ax + aw / 2, ay + ah * 0.5, 20, ax + aw / 2, ay + ah * 0.5, aw * 0.75);
    night.addColorStop(0, '#3a5a90'); night.addColorStop(0.45, '#1a2240'); night.addColorStop(1, '#060812');
    g.fillStyle = night;
  } else {
    const habitat = g.createRadialGradient(ax + aw / 2, ay + ah * 0.4, 30, ax + aw / 2, ay + ah / 2, aw * 0.8);
    habitat.addColorStop(0, light(col, 0.8)); habitat.addColorStop(0.7, light(col, 0.2)); habitat.addColorStop(1, dark(col, 0.35));
    g.fillStyle = habitat;
  }
  rr(g, ax, ay, aw, ah, 10); g.fill();
  g.save(); rr(g, ax, ay, aw, ah, 10); g.clip();
  if (L) {
    let sd = seed ^ 0x9e37; const R = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 100; i++) {
      const px = ax + R() * aw, py = ay + R() * ah * 0.8, r = 0.6 + R() * 1.6;
      g.fillStyle = `rgba(200,230,255,${0.35 + R() * 0.6})`; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    }
  }
  g.save(); g.translate(ax + aw / 2, ay + ah * 0.55);
  g.fillStyle = L ? 'rgba(72,163,244,0.14)' : 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 12; i++) {
    g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(-48, -700); g.lineTo(48, -700); g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(ax + aw / 2, ay + ah * 0.87, aw * 0.28, ah * 0.055, 0, 0, Math.PI * 2); g.fill();
  if (c.portrait) {
    try {
      const p = await loadImg(c.portrait);
      const ps = L ? 580 : 640;
      g.drawImage(p, ax + aw / 2 - ps / 2, ay + ah - ps * (L ? 0.97 : 0.95), ps, ps);
    } catch { /* sin retrato */ }
  }
  holo(g, ax, ay, aw, ah, foil, t + 0.3, 10);
  if (foil >= 0.7) glitter(g, ax, ay, aw, ah, c.shiny ? 120 : 60, seed);
  g.restore();

  // moneda logo
  if (c.token?.logo) {
    try {
      const lg = await loadImg(c.token.logo);
      const cx = ax + aw - 48, cy = ay + 48;
      g.save(); g.beginPath(); g.arc(cx, cy, 38, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.clip();
      const iw = lg.naturalWidth || lg.width, ih = lg.naturalHeight || lg.height;
      const k = Math.max(68 / iw, 68 / ih);
      g.drawImage(lg, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k);
      g.restore();
      g.strokeStyle = gold ? 'rgba(180,130,40,0.7)' : 'rgba(47,108,192,0.55)';
      g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 38, 0, Math.PI * 2); g.stroke();
    } catch { /* logo */ }
  }

  // —— tira de especie ——
  const sy = ay + ah + 26;
  const strip = g.createLinearGradient(0, sy, 0, sy + 34);
  if (L) { strip.addColorStop(0, '#2a3a5a'); strip.addColorStop(1, '#1a2840'); }
  else { strip.addColorStop(0, gold ? '#fff0b8' : '#f0f6ff'); strip.addColorStop(1, gold ? '#e3b94a' : '#b8cce8'); }
  g.fillStyle = strip; rr(g, 84, sy, CW - 168, 34, 17); g.fill();
  g.strokeStyle = L ? 'rgba(255,215,120,0.4)' : 'rgba(20,45,90,0.3)'; g.lineWidth = 1.5;
  rr(g, 84, sy, CW - 168, 34, 17); g.stroke();
  g.fillStyle = L ? '#fff6d8' : '#15233b'; g.font = "italic 700 17px 'Nunito', sans-serif"; g.textAlign = 'center';
  const stripTxt = c.token
    ? `No. ${String(c.dexNo).padStart(4, '0')}   ${sp.name}   ·   ${zone}   ·   Lv ${level}   ·   ${usd(c.token.marketCap)}`
    : `No. ${String(c.dexNo).padStart(4, '0')}   ${sp.name}   ·   ${zone}   ·   Lv ${level}   ·   ${rar}`;
  g.fillText(fit(g, stripTxt, CW - 200), CW / 2, sy + 24);
  g.textAlign = 'left';

  // —— ataques ——
  const moves = [
    { cost: [type, type], name: MOVE_NAME[type] || 'Ape In', dmg: Math.round(75 * (0.5 + f.atk / 200)), text: tr('card.move1', { type }) },
    { cost: ['Normal' as MonType], name: type === 'Normal' ? 'Market Buy' : 'Ape In', dmg: Math.round(50 * (0.5 + f.atk / 200)), text: tr('card.move2') },
  ];
  let y = sy + 66;
  for (const m of moves) {
    m.cost.forEach((tp, i) => energy(g, 108 + i * 46, y + 26, 18, tp));
    g.fillStyle = pal.ink; g.font = "800 34px 'Baloo 2', sans-serif"; g.fillText(m.name, 210, y + 36);
    g.textAlign = 'right'; g.font = "800 42px 'Baloo 2', sans-serif"; g.fillStyle = pal.dmg;
    g.fillText(String(m.dmg), CW - 86, y + 40); g.textAlign = 'left';
    g.fillStyle = L ? pal.sub : '#2b4460'; g.font = "600 17px 'Nunito', sans-serif";
    g.fillText(fit(g, m.text, CW - 300), 210, y + 66);
    y += 100;
    g.strokeStyle = pal.line; g.lineWidth = 1; g.beginPath(); g.moveTo(92, y - 14); g.lineTo(CW - 92, y - 14); g.stroke();
  }

  // —— debilidad · resistencia · stats ——
  const wy = y + 4;
  g.fillStyle = pal.box; rr(g, 74, wy, CW - 148, 52, 12); g.fill();
  g.fillStyle = pal.ink; g.font = "700 15px 'Nunito', sans-serif";
  const wk = weakTo(type)[0], rs = resists(type)[0];
  g.fillText(tr('card.weakness'), 94, wy + 20);
  if (wk) { energy(g, 112, wy + 38, 11, wk as MonType); g.fillStyle = pal.ink; g.font = "800 16px 'Nunito', sans-serif"; g.fillText('×2', 132, wy + 44); }
  else { g.font = "800 16px 'Nunito', sans-serif"; g.fillText('—', 100, wy + 44); }
  g.fillStyle = pal.ink; g.font = "700 15px 'Nunito', sans-serif"; g.fillText(tr('card.resistance'), 290, wy + 20);
  if (rs) { energy(g, 308, wy + 38, 11, rs as MonType); g.fillStyle = pal.ink; g.font = "800 16px 'Nunito', sans-serif"; g.fillText('−20', 328, wy + 44); }
  else { g.font = "800 16px 'Nunito', sans-serif"; g.fillText('—', 296, wy + 44); }
  g.fillStyle = pal.ink; g.font = "700 15px 'Nunito', sans-serif"; g.textAlign = 'right';
  g.fillText(tr('card.stats'), CW - 94, wy + 20);
  g.font = "800 16px 'Nunito', sans-serif";
  g.fillText(`ATK ${f.atk}  ·  DEF ${f.def}  ·  SPD ${f.spd}`, CW - 94, wy + 44);
  g.textAlign = 'left';

  // —— descripción ——
  const fyy = wy + 68;
  g.fillStyle = L ? pal.box : 'rgba(255,255,255,0.7)'; rr(g, 74, fyy, CW - 148, 72, 12); g.fill();
  g.strokeStyle = L ? 'rgba(255,215,120,0.3)' : 'rgba(20,45,90,0.2)'; g.lineWidth = 1;
  rr(g, 74, fyy, CW - 148, 72, 12); g.stroke();
  g.fillStyle = L ? pal.sub : '#2b4460'; g.font = "italic 600 16px 'Nunito', sans-serif";
  const l1 = tr('card.from', { type, zone }) + (c.trainer ? tr('card.caughtBy', { who: c.trainer }) : '');
  const l2 = c.token
    ? `$${c.token.symbol} ${tr('card.onMonad')} · mcap ${usd(c.token.marketCap)} · ${c.token.address.slice(0, 6)}…${c.token.address.slice(-4)}${c.fainted ? tr('card.fainted') : ''}`
    : tr('card.base', { rate: sp.rate, tier: rar });
  g.fillText(fit(g, l1, CW - 180), 92, fyy + 30); g.fillText(fit(g, l2, CW - 180), 92, fyy + 54);

  // —— pie ——
  const by = CH - 58;
  g.fillStyle = pal.ink; g.font = "700 15px 'Nunito', sans-serif"; g.textAlign = 'left';
  g.fillText(`PokeMonad${c.shiny ? ' · ✨ Shiny' : ''}`, 76, by);
  g.textAlign = 'right'; g.font = "800 17px 'Nunito', sans-serif";
  g.fillText(`${String(c.dexNo).padStart(3, '0')}/${String(c.total || 26).padStart(3, '0')}  ${RARITY_SYM[rar]}`, CW - 76, by);
  g.textAlign = 'left';
  if (foil >= 0.9) glitter(g, 38, 38, CW - 76, CH - 76, 80, seed + 7);
  return cv;
}

const cache = new Map<string, Promise<string>>();
export async function cardImage(c: CardData): Promise<string> {
  const key = `poke5|${getLang()}|${c.species.id}|${c.species.name}|${c.level}|${c.shiny ? 1 : 0}|${c.portrait ? 1 : 0}|${c.token?.address ?? ''}|${c.token?.marketCap ?? ''}|${c.token?.logo ?? ''}|${c.fainted ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = drawCard(c).then((cv) => cv.toDataURL('image/jpeg', 0.92));
  cache.set(key, p);
  return p;
}
