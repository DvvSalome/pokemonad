// Minimapa de la región y mapa grande. La imagen de la región se pinta una sola vez desde el mismo
// terreno que el 3D (groundColor + sombreado de relieve + agua/lava); encima, cada frame, el jugador con
// su cono de visión y los monstruos cercanos como puntos (los raros brillan). Norte (−z) arriba.
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { heightAt, groundColor, surfaceY, inLava, placeAt, PLACES } from '../world/terrain';
import { playerPos, useWild } from '../world/wildStore';
import { radarOn, isShiny } from '../world/buffs';
import { orbit, forwardFromYaw } from '../world/cameraStore';
import type { Spawn } from '../world/species';
import { tk, useT } from '../i18n';

export const ZONE_NAME: Record<string, string> = {
  meadow: 'Sunny Meadow', lake: 'Mirror Lake', woods: 'Deepwood', volcano: 'Ember Crater',
  peak: 'Frost Peak', ruins: 'Old Ruins', summit: 'Sky Summit',
};
/** Nombre de la zona en el idioma actual (ZONE_NAME queda como respaldo en inglés). */
export const zoneName = (z: string) => tk(`zone.${z}`, ZONE_NAME[z] ?? z);
export const ZONE_COLOR: Record<string, string> = {
  meadow: '#7fd35b', lake: '#4fb4ff', woods: '#2f9a4a', volcano: '#ff6a3d', peak: '#bfe4ff', ruins: '#e7c46a', summit: '#b2e06b',
};
const TIER_COLOR: Record<string, string> = { Common: '#ffffff', Uncommon: '#6ee07e', Rare: '#4fa8ff', Epic: '#c77dff' };
const SEE: Record<string, number> = { Rare: 34, Epic: 16 };

const EXTENT = 172;
const RES = 256;
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
      if (Math.hypot(x, z * 0.95) > 156) { r *= 0.72; g *= 0.72; b *= 0.72; }
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

export const Minimap: React.FC<{ zone: string; onOpen: () => void }> = ({ zone, onOpen }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const north = useRef<HTMLSpanElement>(null);
  const t = useT();
  const wild = useWild();
  const spawnsRef = useRef(wild.spawns);
  spawnsRef.current = wild.spawns;

  // Minimapa que gira con la cámara: lo que tienes delante queda arriba, y la N recorre el borde.
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = 150;
    cv.width = cv.height = S * dpr;
    const ctx = cv.getContext('2d')!;
    const img = regionImage();
    const VIEW = 46;
    const ppm = S / (VIEW * 2);
    let raf = 0, last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 50) return;
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#2d6a3e'; ctx.fillRect(0, 0, S, S);
      const a = heading();
      ctx.translate(S / 2, S / 2); ctx.rotate(-a); ctx.translate(-S / 2, -S / 2);
      const srcPerM = RES / (EXTENT * 2);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, toPx(playerPos.x - VIEW, RES), toPx(playerPos.z - VIEW, RES), VIEW * 2 * srcPerM, VIEW * 2 * srcPerM, 0, 0, S, S);
      const map = (x: number, z: number): [number, number] => [S / 2 + (x - playerPos.x) * ppm, S / 2 + (z - playerPos.z) * ppm];
      drawDots(ctx, spawnsRef.current, map, 3.4, now / 1000);
      ctx.restore();
      drawPlayer(ctx, S / 2, S / 2, 7, 34, 0);
      if (north.current) {
        const R = cv.clientWidth / 2 - 12;
        north.current.style.transform = `translate(calc(-50% + ${-Math.sin(a) * R}px), calc(-50% + ${-Math.cos(a) * R}px))`;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <button className="pg-minimap2" onClick={onOpen} title={t('map.openTitle')} style={{ ['--zc' as string]: ZONE_COLOR[zone] }}>
      <canvas ref={ref} />
      <span className="n" ref={north}>N</span>
      <span className="zone">{zoneName(zone)}</span>
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
      ctx.drawImage(img, 0, 0, size, size);
      for (const [k, p] of Object.entries(PLACES)) {
        const [px, py] = map(p.x, p.z);
        const here = k === zone;
        ctx.font = `800 ${here ? 17 : 15}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(21,35,59,0.85)'; ctx.lineJoin = 'round';
        const label = zoneName(k).toUpperCase();
        ctx.strokeText(label, px, py);
        ctx.fillStyle = here ? '#ffd84a' : '#fff';
        ctx.fillText(label, px, py);
      }
      drawDots(ctx, spawnsRef.current, map, 4.2, now / 1000);
      const [mx, my] = map(playerPos.x, playerPos.z);
      drawPlayer(ctx, mx, my, 9, 46);
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
