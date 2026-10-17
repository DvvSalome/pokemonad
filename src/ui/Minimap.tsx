// Minimapa de la región y mapa grande. La imagen de la región se pinta una sola vez desde el mismo
// terreno que el 3D (groundColor + sombreado de relieve + agua/lava); encima, cada frame, el jugador con
// su cono de visión y los monstruos cercanos como puntos (los raros brillan). Norte (−z) arriba.
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { heightAt, groundColor, surfaceY, inLava, placeAt, PLACES, COLISEUMS, COLISEUM, PATHS, WORLD_R, dist } from '../world/terrain';
import { playerPos, useWild } from '../world/wildStore';
import { radarOn, isShiny } from '../world/buffs';
import { orbit, forwardFromYaw } from '../world/cameraStore';
import type { Spawn } from '../world/species';
import { tk, useT } from '../i18n';

export const ZONE_NAME: Record<string, string> = {
  meadow: 'Sunny Meadow', lake: 'Mirror Lake', woods: 'Deepwood', volcano: 'Ember Crater',
  peak: 'Frost Peak', ruins: 'Old Ruins', summit: 'Sky Summit',
  storm: 'Thunder Mesa', sands: 'Sunset Dunes', crystal: 'Crystal Hollow',
};
/** Nombre de la zona en el idioma actual (ZONE_NAME queda como respaldo en inglés). */
export const zoneName = (z: string) => tk(`zone.${z}`, ZONE_NAME[z] ?? z);
export const ZONE_COLOR: Record<string, string> = {
  meadow: '#7fd35b', lake: '#4fb4ff', woods: '#2f9a4a', volcano: '#ff6a3d', peak: '#bfe4ff', ruins: '#e7c46a', summit: '#b2e06b',
  storm: '#c7a9ff', sands: '#ffc864', crystal: '#a9d8ff',
};
const TIER_COLOR: Record<string, string> = { Common: '#ffffff', Uncommon: '#6ee07e', Rare: '#4fa8ff', Epic: '#c77dff' };
const SEE: Record<string, number> = { Rare: 34, Epic: 16 };

const EXTENT = 268;
const RES = 320;
let regionImg: HTMLCanvasElement | null = null;

function regionImage(): HTMLCanvasElement {
  if (regionImg) return regionImg;
  const c = document.createElement('canvas');
  c.width = c.height = RES;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(RES, RES);
  const col = new THREE.Color();
  const step = (EXTENT * 2) / RES;
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const x = -EXTENT + (i + 0.5) * step, z = -EXTENT + (j + 0.5) * step;
      const h = heightAt(x, z);
      let r: number, g: number, b: number;
      if (surfaceY(x, z) > h + 0.05) { r = 0.36; g = 0.7; b = 0.95; }
      else if (inLava(x, z)) { r = 1; g = 0.45; b = 0.16; }
      else {
        groundColor(x, z, h, col);
        const shade = Math.max(0.62, Math.min(1.25, 1 + (heightAt(x - step, z - step) - h) * 0.09));
        r = col.r * shade; g = col.g * shade; b = col.b * shade;
      }
      if (Math.hypot(x, z * 0.95) > WORLD_R) { r *= 0.72; g *= 0.72; b *= 0.72; }
      const k = (j * RES + i) * 4;
      img.data[k] = Math.min(255, r * 255); img.data[k + 1] = Math.min(255, g * 255); img.data[k + 2] = Math.min(255, b * 255); img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  regionImg = c;
  return c;
}

const toPx = (v: number, size: number) => ((v + EXTENT) / (EXTENT * 2)) * size;

/** Punto de monstruo; los Rare/Epic solo aparecen cerca (como en el mundo) o con el Radar activo. */
function visible(sp: Spawn) {
  const see = SEE[sp.species.tier];
  return !see || radarOn() || Math.hypot(sp.x - playerPos.x, sp.z - playerPos.z) < see;
}

function drawDots(ctx: CanvasRenderingContext2D, spawns: Spawn[], map: (x: number, z: number) => [number, number], r: number, t: number) {
  for (const sp of spawns) {
    if (!visible(sp)) continue;
    const [px, py] = map(sp.x, sp.z);
    const rare = sp.species.tier === 'Rare' || sp.species.tier === 'Epic';
    const shiny = isShiny(sp.id);
    if (rare || shiny) {
      const pulse = 1 + Math.sin(t * 5 + sp.x) * 0.25;
      ctx.fillStyle = shiny ? 'rgba(255,216,74,0.45)' : 'rgba(160,120,255,0.4)';
      ctx.beginPath(); ctx.arc(px, py, r * 2.3 * pulse, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = shiny ? '#ffd84a' : TIER_COLOR[sp.species.tier] ?? '#fff';
    ctx.strokeStyle = '#15233b'; ctx.lineWidth = Math.max(1, r * 0.45);
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

/** El Coliseo Trueno es la academia de Monad: en el mapa va en violeta, el resto en marfil. */
const pinColor = (key: string) => (key === 'bolt' ? '#836EF9' : '#f4efe4');

/** Rombo de coliseo. `label` solo en el mapa grande o cuando el pin cabe en el recorte. */
function drawPin(ctx: CanvasRenderingContext2D, px: number, py: number, r: number, key: string, label?: string) {
  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = pinColor(key);
  ctx.strokeStyle = '#0c1210';
  ctx.lineWidth = Math.max(1.25, r * 0.28);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.35); ctx.lineTo(r, 0); ctx.lineTo(0, r * 1.15); ctx.lineTo(-r, 0);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  if (key === 'bolt') {
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.28, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  if (!label) return;
  ctx.font = `600 ${Math.max(10, r * 1.7)}px "Barlow Condensed", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,10,0.85)'; ctx.lineJoin = 'round';
  ctx.strokeText(label, px, py + r * 1.35);
  ctx.fillStyle = key === 'bolt' ? '#d7ccff' : '#f4efe4';
  ctx.fillText(label, px, py + r * 1.35);
}

/** Rumbo de la cámara en el mapa (0 = norte, sentido horario). */
const heading = () => { const f = forwardFromYaw(orbit.yaw); return Math.atan2(f.x, -f.z); };

function drawPlayer(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, cone: number, a = heading()) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, cone);
  g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, cone, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ff3b5c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.28; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, -s * 1.25); ctx.lineTo(s * 0.9, s * 0.85); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.9, s * 0.85); ctx.closePath();
  ctx.stroke(); ctx.fill();
  ctx.restore();
}

/** Zona actual del jugador (con histéresis: si sale de todas, conserva la última). */
export function useZone(): string {
  const [zone, setZone] = useState('meadow');
  useEffect(() => {
    const t = setInterval(() => {
      const z = placeAt(playerPos.x, playerPos.z);
      if (z) setZone((cur) => (cur === z ? cur : z));
    }, 400);
    return () => clearInterval(t);
  }, []);
  return zone;
}

const ARRIVED = () => COLISEUM.wall + COLISEUM.wallT + 6;

export const Minimap: React.FC<{ zone: string; onOpen: () => void }> = ({ zone, onOpen }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const nearRef = useRef<HTMLSpanElement>(null);
  const t = useT();
  const wild = useWild();
  const spawnsRef = useRef(wild.spawns);
  spawnsRef.current = wild.spawns;

  // Brújula circular, norte arriba. Sin nombres sobre el terreno: el más cercano va en el pie.
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = 188;
    const R = S / 2 - 1;
    const VIEW = 112;
    const ppm = (R - 8) / VIEW;
    cv.width = cv.height = S * dpr;
    const ctx = cv.getContext('2d')!;
    const img = regionImage();
    let raf = 0, last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 50) return;
      last = now;
      const cx = S / 2, cy = S / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#10261c';
      ctx.fillRect(0, 0, S, S);
      const srcPerM = RES / (EXTENT * 2);
      const span = (R / ppm) * 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        img,
        toPx(playerPos.x - span / 2, RES), toPx(playerPos.z - span / 2, RES),
        span * srcPerM, span * srcPerM,
        cx - R, cy - R, R * 2, R * 2,
      );
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      for (const meters of [40, 80]) {
        ctx.beginPath();
        ctx.arc(cx, cy, meters * ppm, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.stroke();
      const shade = ctx.createRadialGradient(cx, cy, R * 0.42, cx, cy, R);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(4,8,6,0.62)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, S, S);
      const map = (x: number, z: number): [number, number] => [cx + (x - playerPos.x) * ppm, cy + (z - playerPos.z) * ppm];
      let nearest: { key: string; d: number } | null = null;
      for (const c of COLISEUMS) {
        const d = dist(playerPos.x, playerPos.z, c);
        if (!nearest || d < nearest.d) nearest = { key: c.key, d };
        const [px, py] = map(c.x, c.z);
        if (Math.hypot(px - cx, py - cy) > R - 6) continue;
        if (c.key === 'bolt') {
          const pulse = 1 + Math.sin(now / 280) * 0.18;
          ctx.strokeStyle = 'rgba(131,110,249,0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 8 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        drawPin(ctx, px, py, c.key === 'bolt' ? 5.5 : 4.2, c.key);
      }
      drawDots(ctx, spawnsRef.current, map, 2.4, now / 1000);
      drawPlayer(ctx, cx, cy, 5.5, 22, heading());
      ctx.restore();
      ctx.fillStyle = '#e8a33d';
      ctx.beginPath();
      ctx.moveTo(cx, 7); ctx.lineTo(cx - 4.5, 15); ctx.lineTo(cx + 4.5, 15);
      ctx.closePath();
      ctx.fill();
      if (nearRef.current && nearest) {
        const name = tk(`site.${nearest.key}`, nearest.key);
        nearRef.current.textContent = nearest.d < ARRIVED()
          ? t('map.hereSite', { name })
          : t('map.nearest', { name, m: Math.round(nearest.d) });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [t]);

  return (
    <button className="pg-minimap2" onClick={onOpen} title={t('map.openTitle')} style={{ ['--zc' as string]: ZONE_COLOR[zone] }}>
      <span className="hd"><b>{t('map.region')}</b><kbd>M</kbd></span>
      <span className="frame"><canvas ref={ref} /></span>
      <span className="zone">{zoneName(zone)}</span>
      <span className="near" ref={nearRef} />
    </button>
  );
};

export const RegionMap: React.FC<{ zone: string; onClose: () => void }> = ({ zone, onClose }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const t = useT();
  const wild = useWild();
  const spawnsRef = useRef(wild.spawns);
  spawnsRef.current = wild.spawns;
  const [size] = useState(() => Math.floor(Math.min(window.innerHeight * 0.78, window.innerWidth * 0.9, 760)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    const img = regionImage();
    const map = (x: number, z: number): [number, number] => [toPx(x, size), toPx(z, size)];
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      const cx = size / 2, cy = size / 2, R = size / 2 - 1;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#14324a';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(244, 232, 208, 0.72)';
      ctx.lineWidth = Math.max(2, size / 220);
      for (const curve of Object.values(PATHS)) {
        const pts = curve.getSpacedPoints(42);
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = toPx(p.x, size), y = toPx(p.z, size);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      const edge = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
      edge.addColorStop(0, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(4,8,14,0.55)');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, size, size);
      for (const c of COLISEUMS) {
        const [px, py] = map(c.x, c.z);
        drawPin(ctx, px, py, c.key === 'bolt' ? size / 70 : size / 110, c.key);
      }
      const taken: { x: number; y: number; w: number; h: number }[] = [];
      const hits = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      const places = Object.entries(PLACES).sort((a, b) => (a[0] === zone ? 1 : 0) - (b[0] === zone ? 1 : 0));
      for (const [k, p] of places) {
        const [px, py] = map(p.x, p.z);
        const here = k === zone;
        const color = ZONE_COLOR[k] ?? '#fff';
        ctx.fillStyle = color;
        ctx.strokeStyle = '#0c1210';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, here ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        if (here) {
          ctx.strokeStyle = '#e8a33d';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 11, 0, Math.PI * 2);
          ctx.stroke();
        }
        const label = zoneName(k).toUpperCase();
        ctx.font = `600 ${here ? 13 : 12}px "Barlow Condensed", "Segoe UI", sans-serif`;
        const w = ctx.measureText(label).width + 12;
        const h = 16;
        const spots: [number, number][] = [
          [px - w / 2, py + 12],
          [px - w / 2, py - 28],
          [px + 14, py - h / 2],
          [px - w - 14, py - h / 2],
        ];
        let spot = spots[0];
        for (const s of spots) {
          const box = { x: s[0], y: s[1], w, h };
          if (!taken.some((t) => hits(t, box))) { spot = s; break; }
        }
        taken.push({ x: spot[0], y: spot[1], w, h });
        ctx.beginPath();
        ctx.roundRect(spot[0], spot[1], w, h, 8);
        ctx.fillStyle = 'rgba(8, 10, 16, 0.82)';
        ctx.fill();
        if (here) { ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fillStyle = here ? '#ffe7a3' : '#f4efe4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, spot[0] + w / 2, spot[1] + h / 2 + 0.5);
      }
      drawDots(ctx, spawnsRef.current, map, 3.4, now / 1000);
      const [mx, my] = map(playerPos.x, playerPos.z);
      drawPlayer(ctx, mx, my, 8, 36);
      ctx.restore();
      ctx.fillStyle = '#e8a33d';
      ctx.beginPath();
      ctx.moveTo(cx, 10); ctx.lineTo(cx - 5, 20); ctx.lineTo(cx + 5, 20);
      ctx.closePath();
      ctx.fill();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, zone]);

  return (
    <div className="pg-overlay" onClick={onClose}>
      <div className="pg-regionmap" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('nav.map')}</h2>
          <span className="here" style={{ ['--zc' as string]: ZONE_COLOR[zone] }}>{t('map.youAreIn')} <b>{zoneName(zone)}</b></span>
          <button className="x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </header>
        <canvas ref={ref} style={{ width: size, height: size }} />
        <footer>
          {(['Common', 'Uncommon', 'Rare', 'Epic'] as const).map((tier) => (
            <span key={tier}><i style={{ background: TIER_COLOR[tier] }} />{tier}</span>
          ))}
          <span><i style={{ background: '#ffd84a' }} />{t('map.shiny')}</span>
          <span className="note">{t(radarOn() ? 'map.radarOn' : 'map.radarOff')}</span>
        </footer>
      </div>
    </div>
  );
};
