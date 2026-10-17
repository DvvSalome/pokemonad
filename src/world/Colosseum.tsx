// Los coliseos de la región (COLISEUMS en terrain.ts): arena de piedra y tierra batida, barrera
// baja, gradas de madera escalonadas, muralla con almenas, torres con tejado cónico, portón de arco al
// oeste, estandartes azules (lado del jugador, este) y rojos (lado del salvaje, oeste), braseros y antorchas
// con fuego que parpadea y brilla más de noche. Fuera, el ramal que llega desde el camino del sur (PATHS.arena)
// con su cartel, antorchas, un par de puestos de mercado, un carro y tiendas de torneo.
//
// Todo lo repetido va instanciado (almenas, estandartes, llamas, público) y la mampostería fusionada en unas
// pocas geometrías: el recinto entero son unas cuantas decenas de draw calls.
//
// Hay nueve sedes, una por bioma. Comparten la planta y la geometría —que se construye UNA sola vez y se
// reutiliza en todas, porque nueve recintos construidos por separado serían nueve veces el mismo merge—
// y se diferencian por el giro del portón y por su paleta (ColiseumSite.theme). Solo la sede principal
// tiene camino de llegada con puestos, público y combates: las demás están ahí para encontrarlas.

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from './toon';
import { ARENA, COLISEUMS, COLISEUM, COLISEUM_SCALE, GATE_HALF, PATHS, arenaY, heightAt, type ColiseumSite } from './terrain';
import { stage } from './arenaLayout';
import { useBattle } from './battleStore';
import { t as tr, onLangChange } from '../i18n';

const TAU = Math.PI * 2;
/**
 * La geometría de este archivo se escribe en las unidades de siempre y el recinto entero se escala por
 * COLISEUM_SCALE al colocarlo. Así el edificio crece sin tocar una sola cota: lo único que hay que hacer
 * es traer los radios del terreno (que ya vienen multiplicados) de vuelta a unidades locales.
 */
const S = COLISEUM_SCALE;
const C = {
  floor: COLISEUM.floor / S, barrier: COLISEUM.barrier / S, stands0: COLISEUM.stands0 / S,
  wall: COLISEUM.wall / S, wallT: COLISEUM.wallT / S,
};
const GH = GATE_HALF / S;
/** Suelo del recinto relativo a la arena de piedra (el terreno está aplanado 0.14 m por debajo). */
const G = -0.14;
const WALL_H = 4.2;
const BARRIER_H = 1.3;
const ROWS = 4, ROW_D = 0.95, ROW_H = 0.62, ROW_Y0 = 0.75;
const rowR = (i: number) => C.stands0 + i * ROW_D;
const rowY = (i: number) => ROW_Y0 + i * ROW_H;
const BLUE = 0x2f64c9, RED = 0xc23a2e, GOLD = 0xf2c14e;
const opt = { occlude: false } as const;

type Theme = ColiseumSite['theme'];
/** Oscurece un color multiplicando sus canales: las contrahuellas y las cornisas de cada paleta. */
const shade = (hex: number, k: number) =>
  ((Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k));
const hexStr = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
/** Un punto en coordenadas locales del recinto, llevado al mundo (deshace el giro de la sede). */
function toWorld(s: ColiseumSite, lx: number, lz: number): [number, number] {
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
}

/** Medio ángulo del hueco de la puerta (oeste, θ = π) a un radio dado. */
const gapAt = (r: number, half = GH + 0.2) => Math.asin(Math.min(0.95, half / r));
/** Distancia angular al oeste (la puerta). */
const fromGate = (a: number) => Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)));

/**
 * Anillo macizo con hueco en la puerta: cara exterior, interior y tapa. θ del mundo = atan2(z, x); el
 * cilindro de three usa x = r·sinφ, z = r·cosφ, así que el oeste es φ = −π/2.
 */
function wallRing(r0: number, r1: number, y0: number, y1: number, gap: number, seg = 96) {
  const h = y1 - y0, ym = (y0 + y1) / 2;
  const phi0 = -Math.PI / 2 + gap, len = TAU - 2 * gap;
  return mergeGeometries([
    new THREE.CylinderGeometry(r1, r1, h, seg, 1, true, phi0, len).translate(0, ym, 0),
    new THREE.CylinderGeometry(r0, r0, h, seg, 1, true, phi0, len).translate(0, ym, 0),
    new THREE.RingGeometry(r0, r1, seg, 1, Math.PI + gap, len).rotateX(-Math.PI / 2).translate(0, y1, 0),
  ])!;
}

/** Cuánto de "noche" hay ahora (la hora real, como el ciclo de día). */
function nightness() {
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  if (h >= 19.5 || h < 5.5) return 1;
  if (h >= 17) return (h - 17) / 2.5;
  if (h < 7.5) return (7.5 - h) / 2;
  return 0;
}

// ---------------------------------------------------------------- texturas pintadas

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Arena: tierra batida con un anillo de losas, el blasón central y las marcas de salida de cada bando. */
function floorTexture(theme: Theme) {
  const S = 1024, R = C.floor + 0.3, k = S / (2 * R);
  return canvasTex(S, S, (g) => {
    const cx = S / 2, cy = S / 2;
    g.fillStyle = '#9a917f'; g.fillRect(0, 0, S, S);
    // losas del anillo exterior
    g.save(); g.beginPath(); g.arc(cx, cy, R * k, 0, TAU); g.clip();
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let ring = 0; ring < 3; ring++) {
      const r0 = (7.7 + ring * 0.55) * k, r1 = r0 + 0.55 * k, n = 28 + ring * 4;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + ring * 0.07, a1 = ((i + 1) / n) * TAU + ring * 0.07;
        const l = 150 + rnd() * 26;
        g.fillStyle = `rgb(${l},${l - 8},${l - 22})`;
        g.beginPath(); g.arc(cx, cy, r1, a0, a1); g.arc(cx, cy, r0, a1, a0, true); g.closePath(); g.fill();
        g.strokeStyle = '#6f675b'; g.lineWidth = 3; g.stroke();
      }
    }
    g.restore();
    // tierra batida
    g.fillStyle = '#d6bd8a'; g.beginPath(); g.arc(cx, cy, 7.7 * k, 0, TAU); g.fill();
    for (let i = 0; i < 2600; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * 7.6 * k;
      g.fillStyle = rnd() < 0.5 ? 'rgba(150,118,70,0.18)' : 'rgba(255,240,205,0.2)';
      g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + rnd() * 5, 2 + rnd() * 5);
    }
    g.strokeStyle = 'rgba(120,92,52,0.55)'; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, 7.5 * k, 0, TAU); g.stroke();
    // blasón central
    g.strokeStyle = 'rgba(110,84,48,0.6)'; g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cy, 1.25 * k, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(cx, cy - 1.9 * k); g.lineTo(cx, cy + 1.9 * k); g.stroke();
    // marcas de salida: el canvas va +x = este (jugador), arriba = −z
    const mark = (x: number, col: string) => {
      g.fillStyle = col; g.globalAlpha = 0.28;
      g.beginPath(); g.arc(cx + x * k, cy, 1.45 * k, 0, TAU); g.fill();
      g.globalAlpha = 0.85; g.strokeStyle = col; g.lineWidth = 10;
      g.beginPath(); g.arc(cx + x * k, cy, 1.45 * k, 0, TAU); g.stroke();
      g.globalAlpha = 1;
    };
    mark(2.7, hexStr(theme.a)); mark(-2.7, hexStr(theme.b));
  });
}

/** Estandarte con cola de golondrina, ribete dorado y un escudo (se tiñe por instancia). */
function bannerTexture() {
  return canvasTex(128, 256, (g) => {
    g.clearRect(0, 0, 128, 256);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 0); g.lineTo(128, 256); g.lineTo(64, 206); g.lineTo(0, 256); g.closePath(); g.fill();
    g.strokeStyle = '#ffe79a'; g.lineWidth = 10;
    g.beginPath(); g.moveTo(8, 4); g.lineTo(8, 238); g.moveTo(120, 4); g.lineTo(120, 238); g.stroke();
    g.fillStyle = '#ffe79a'; g.fillRect(0, 0, 128, 18);
    g.beginPath(); g.moveTo(40, 70); g.lineTo(88, 70); g.lineTo(88, 112); g.quadraticCurveTo(64, 146, 40, 112); g.closePath(); g.fill();
  });
}

function stripeTexture(a: string, b: string, n = 8) {
  const t = canvasTex(256, 64, (g) => {
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * 256) / n, 0, 256 / n + 1, 64); }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

let _glow: THREE.Texture | null = null;
function glowTexture() {
  if (_glow) return _glow;
  _glow = canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,220,150,1)'); r.addColorStop(0.25, 'rgba(255,160,60,0.55)'); r.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
  return _glow;
}

function drawSign(g: CanvasRenderingContext2D) {
    g.fillStyle = '#7a4e2a'; g.fillRect(0, 0, 512, 192);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#86572f' : '#6f4524'; g.fillRect(0, i * 48, 512, 46); }
    g.strokeStyle = '#3e2714'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 182);
    g.fillStyle = '#ffe7b0'; g.font = '800 92px "Baloo 2", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`◀ ${tr('arena.sign')}`, 256, 88);
    g.font = '700 34px "Baloo 2", Georgia, serif'; g.fillStyle = '#f2c14e';
    g.fillText(`⚔  ${tr('arena.signSub')}  ⚔`, 256, 158);
}
/** Cartel del camino: se repinta sobre el mismo lienzo al cambiar de idioma. */
function signTexture() {
  const tex = canvasTex(512, 192, drawSign);
  onLangChange(() => {
    const c = tex.image as HTMLCanvasElement, g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height); drawSign(g); tex.needsUpdate = true;
  });
  return tex;
}

// ---------------------------------------------------------------- piezas

/**
 * Los materiales de una paleta, construidos una vez y compartidos por todas las sedes que la usan (las
 * nueve tienen la suya, pero el patrón evita duplicarlos si dos coincidieran).
 */
interface Mats { stone: THREE.MeshToonMaterial; stoneDark: THREE.MeshToonMaterial; wood: THREE.MeshToonMaterial; woodDark: THREE.MeshToonMaterial; iron: THREE.MeshToonMaterial; floor: THREE.MeshToonMaterial; roofA: THREE.MeshToonMaterial; roofB: THREE.MeshToonMaterial; awning: THREE.MeshToonMaterial }
const matCache = new Map<string, Mats>();
function matsFor(theme: Theme): Mats {
  const key = `${theme.stone}-${theme.wood}-${theme.a}-${theme.b}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m: Mats = {
    stone: toonMaterial(theme.stone, { rim: 0.05, ...opt }),
    stoneDark: toonMaterial(shade(theme.stone, 0.74), { rim: 0.04, ...opt }),
    wood: toonMaterial(theme.wood, { rim: 0.04, ...opt }),
    woodDark: toonMaterial(shade(theme.wood, 0.66), { rim: 0.03, ...opt }),
    iron: toonMaterial(0x35322f, { rim: 0.05, ...opt }),
    floor: toonMaterial(0xffffff, { rim: 0, map: floorTexture(theme), ...opt }),
    roofA: toonMaterial(theme.a, { rim: 0.06, ...opt }),
    roofB: toonMaterial(theme.b, { rim: 0.06, ...opt }),
    awning: toonMaterial(0xffffff, { rim: 0, map: stripeTexture(hexStr(theme.a), hexStr(theme.b), 6), ...opt }),
  };
  for (const k of ['stone', 'stoneDark', 'wood', 'woodDark'] as const) m[k].side = THREE.DoubleSide;
  matCache.set(key, m);
  return m;
}

interface Tower { x: number; z: number; r: number; h: number; side: 'a' | 'b' }
const TOWERS: Tower[] = [
  // Ninguna torre en el cuadrante sureste: por ahí pasan los planos aéreos de la presentación del combate.
  ...[Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4].map((a) => ({
    x: Math.cos(a) * (C.wall + 0.45), z: Math.sin(a) * (C.wall + 0.45), r: 1.75, h: 6.3, side: (Math.cos(a) > 0 ? 'a' : 'b') as 'a' | 'b',
  })),
  { x: -(C.wall + 0.5), z: GH + 1.8, r: 1.5, h: 6.9, side: 'b' as const },
  { x: -(C.wall + 0.5), z: -GH - 1.8, r: 1.5, h: 6.9, side: 'b' as const },
];

/** Una llama o un brillo: posiciones en coordenadas locales del recinto o del mundo (world = true). */
interface Fire { x: number; y: number; z: number; s: number }

/**
 * Muros, gradas, torres, portón: la mampostería estática del recinto, en coordenadas locales (el portón
 * siempre al oeste; cada sede gira el grupo entero). La geometría se construye una vez y se comparte.
 */
interface Geos {
  stone: THREE.BufferGeometry; dark: THREE.BufferGeometry; wood: THREE.BufferGeometry; woodDark: THREE.BufferGeometry;
  iron: THREE.BufferGeometry; roofA: THREE.BufferGeometry; roofB: THREE.BufferGeometry;
  floor: THREE.BufferGeometry; awning: THREE.BufferGeometry; awningAt: [number, number, number];
}
let geoCache: Geos | null = null;

function coliseumGeos(): Geos {
  if (geoCache) return geoCache;
  const W = C.wall, T = C.wallT;
  const stoneParts: THREE.BufferGeometry[] = [
    wallRing(W, W + T, G, WALL_H, gapAt(W + T / 2, GH + 0.5)),
    wallRing(C.barrier - 0.4, C.barrier, G, BARRIER_H, gapAt(C.barrier, GH + 0.15)),
    // muros del pasillo de la puerta, de la barrera a la muralla
    new THREE.BoxGeometry(W - C.barrier + 0.6, 2.9, 0.45).translate(-(W + C.barrier) / 2, G + 1.45, GH + 0.25),
    new THREE.BoxGeometry(W - C.barrier + 0.6, 2.9, 0.45).translate(-(W + C.barrier) / 2, G + 1.45, -GH - 0.25),
  ];
  const darkParts: THREE.BufferGeometry[] = [
    wallRing(W + T - 0.05, W + T + 0.3, G, 0.8, gapAt(W + T, GH + 0.5)),
    new THREE.CylinderGeometry(C.floor + 0.3, C.floor + 0.3, 0.3, 64, 1, true).translate(0, -0.15, 0),
  ];
  const woodParts: THREE.BufferGeometry[] = [
    wallRing(C.barrier - 0.46, C.barrier + 0.06, BARRIER_H, BARRIER_H + 0.12, gapAt(C.barrier, GH + 0.15)),
  ];
  const woodDarkParts: THREE.BufferGeometry[] = [];
  // gradas: huella clara + contrahuella oscura por fila; la última llega hasta la muralla
  for (let i = 0; i < ROWS; i++) {
    const r = rowR(i), y = rowY(i), gap = gapAt(r, GH + 0.45);
    const d = i === ROWS - 1 ? W - r : ROW_D;
    const phi0 = -Math.PI / 2 + gap, len = TAU - 2 * gap;
    const y0 = i === 0 ? G : rowY(i - 1);
    woodDarkParts.push(new THREE.CylinderGeometry(r, r, y - y0, 96, 1, true, phi0, len).translate(0, (y + y0) / 2, 0));
    woodParts.push(new THREE.RingGeometry(r, r + d, 96, 1, Math.PI + gap, len).rotateX(-Math.PI / 2).translate(0, y, 0));
  }

  // torres: cuerpo, cornisa, tejado cónico (agrupado por bando) y una saetera mirando afuera
  const roofParts: Record<'a' | 'b', THREE.BufferGeometry[]> = { a: [], b: [] };
  const ironParts: THREE.BufferGeometry[] = [];
  for (const t of TOWERS) {
    stoneParts.push(new THREE.CylinderGeometry(t.r, t.r * 1.07, t.h - G, 18).translate(t.x, (t.h + G) / 2, t.z));
    darkParts.push(new THREE.CylinderGeometry(t.r + 0.28, t.r, 0.45, 18).translate(t.x, t.h + 0.2, t.z));
    roofParts[t.side].push(new THREE.ConeGeometry(t.r + 0.45, 2.5, 18).translate(t.x, t.h + 0.42 + 1.25, t.z));
    const a = Math.atan2(t.z, t.x);
    for (const y of [t.h * 0.45, t.h * 0.75]) {
      ironParts.push(new THREE.BoxGeometry(0.16, 0.75, 0.16).translate(t.x + Math.cos(a) * t.r, y, t.z + Math.sin(a) * t.r));
    }
  }

  // portón: muro con arco de medio punto, extruido a lo largo del eje x
  const shape = new THREE.Shape();
  const hw = 3.3, ah = 2.5, ar = GH, top = 5.2;
  shape.moveTo(-hw, 0); shape.lineTo(-ar, 0); shape.lineTo(-ar, ah);
  shape.absarc(0, ah, ar, Math.PI, 0, true);
  shape.lineTo(ar, 0); shape.lineTo(hw, 0); shape.lineTo(hw, top); shape.lineTo(-hw, top); shape.closePath();
  const gate = new THREE.ExtrudeGeometry(shape, { depth: 1.7, bevelEnabled: false, curveSegments: 14 });
  gate.translate(0, 0, -0.85).rotateY(Math.PI / 2).translate(-(W + T / 2), G, 0);
  stoneParts.push(gate);
  // rastrillo levantado, asomando bajo la clave del arco
  for (let i = -3; i <= 3; i++) ironParts.push(new THREE.BoxGeometry(0.09, 0.7, 0.09).translate(-(W + T / 2), G + ah + ar - 0.45, i * 0.42));
  ironParts.push(new THREE.BoxGeometry(0.1, 0.1, 2.9).translate(-(W + T / 2), G + ah + ar - 0.8, 0));

  // palco de honor al norte (+z), el fondo de los planos de combate
  const boxR = rowR(ROWS - 1) + 0.2, boxY = rowY(ROWS - 1);
  for (const sx of [-1.8, 1.8]) for (const dz of [0, 1.2]) woodDarkParts.push(new THREE.BoxGeometry(0.16, 2.1, 0.16).translate(sx, boxY + 1.05, boxR + dz));

  // puertas abiertas hacia fuera
  const doorGeo = (sz: number) => {
    const half = GH / 2, dx = -0.94 * half, dz = -0.34 * sz * half;
    return new THREE.BoxGeometry(GH, 2.9, 0.12).rotateY(sz * 2.79).translate(-(W + T + 0.05) + dx, G + 1.45, sz * GH + dz);
  };
  woodDarkParts.push(doorGeo(1), doorGeo(-1));

  const unify = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  geoCache = {
    stone: unify(stoneParts), dark: unify(darkParts), wood: unify(woodParts), woodDark: unify(woodDarkParts),
    iron: unify(ironParts), roofA: unify(roofParts.a), roofB: unify(roofParts.b),
    floor: new THREE.CircleGeometry(C.floor + 0.3, 72).rotateX(-Math.PI / 2),
    awning: new THREE.BoxGeometry(4.1, 0.1, 1.9), awningAt: [0, boxY + 2.15, boxR + 0.6],
  };
  return geoCache;
}

const Masonry: React.FC<{ theme: Theme }> = ({ theme }) => {
  const built = useMemo(() => {
    const g = coliseumGeos(), m = matsFor(theme);
    const meshes: THREE.Mesh[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const me = new THREE.Mesh(geo, mat); me.castShadow = shadow; me.receiveShadow = true; meshes.push(me);
    };
    add(g.stone, m.stone); add(g.dark, m.stoneDark); add(g.wood, m.wood); add(g.woodDark, m.woodDark);
    add(g.iron, m.iron, false);
    add(g.roofA, m.roofA); add(g.roofB, m.roofB);
    const floor = new THREE.Mesh(g.floor, m.floor); floor.receiveShadow = true; meshes.push(floor);
    // toldo del palco, a franjas de los dos bandos
    const awn = new THREE.Mesh(g.awning, m.awning);
    awn.position.set(...g.awningAt); awn.rotation.x = -0.12; awn.castShadow = true; meshes.push(awn);
    return meshes;
  }, [theme]);
  return <>{built.map((m, i) => <primitive key={i} object={m} />)}</>;
};

/** Almenas de muralla, torres y portón en un solo InstancedMesh. Las posiciones se calculan una vez. */
interface Spot { x: number; y: number; z: number; ry: number }
let merlonSpots: Spot[] | null = null;
function merlonLayout(): Spot[] {
  if (merlonSpots) return merlonSpots;
  const spots: Spot[] = [];
  const W = C.wall, T = C.wallT, rr = W + T - 0.2;
  const n = Math.floor((TAU * rr) / 1.15);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    if (fromGate(a) < gapAt(rr, GH + 2.6)) continue;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (TOWERS.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 0.5)) continue;
    spots.push({ x, y: WALL_H + 0.3, z, ry: -a - Math.PI / 2 });
  }
  for (const t of TOWERS) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      spots.push({ x: t.x + Math.cos(a) * (t.r + 0.1), y: t.h + 0.72, z: t.z + Math.sin(a) * (t.r + 0.1), ry: -a - Math.PI / 2 });
    }
  }
  for (let i = -2; i <= 2; i++) spots.push({ x: -(W + T / 2) - 0.55, y: G + 5.2 + 0.31, z: i * 1.25, ry: Math.PI / 2 });
  merlonSpots = spots;
  return spots;
}
let merlonGeo: THREE.BoxGeometry | null = null;

const Merlons: React.FC<{ theme: Theme }> = ({ theme }) => {
  const mesh = useMemo(() => {
    const spots = merlonLayout();
    merlonGeo ??= new THREE.BoxGeometry(0.62, 0.62, 0.36);
    const im = new THREE.InstancedMesh(merlonGeo, matsFor(theme).stone, spots.length);
    const o = new THREE.Object3D();
    spots.forEach((s, i) => { o.position.set(s.x, s.y, s.z); o.rotation.set(0, s.ry, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.castShadow = true; im.receiveShadow = true;
    return im;
  }, [theme]);
  return <primitive object={mesh} />;
};

/** Estandartes colgados: fuera de la muralla, dentro sobre las gradas y en la barrera detrás de cada bando. */
interface BannerSpot { a: number; r: number; y: number; w: number; h: number; out: boolean; side: 'a' | 'b' }
let bannerSpots: BannerSpot[] | null = null;
function bannerLayout(): BannerSpot[] {
  if (bannerSpots) return bannerSpots;
  const list: BannerSpot[] = [];
  const W = C.wall, T = C.wallT;
  const side = (a: number): 'a' | 'b' => (Math.cos(a) >= 0 ? 'a' : 'b');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + TAU / 32;
    if (fromGate(a) < 0.4 || TOWERS.some((t) => Math.abs(Math.atan2(Math.sin(a - Math.atan2(t.z, t.x)), Math.cos(a - Math.atan2(t.z, t.x)))) < 0.17)) continue;
    list.push({ a, r: W + T + 0.04, y: WALL_H - 0.1, w: 1.05, h: 2.4, out: true, side: side(a) });
  }
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU;
    if (fromGate(a) < 0.45 || Math.abs(a - Math.PI / 2) < 0.2) continue;
    list.push({ a, r: W - 0.04, y: WALL_H - 0.05, w: 0.85, h: 1.35, out: false, side: side(a) });
  }
  for (const a of [-0.62, -0.21, 0.21, 0.62]) list.push({ a, r: C.barrier - 0.44, y: BARRIER_H, w: 0.78, h: 1.05, out: false, side: 'a' });
  for (const a of [Math.PI - 0.5, Math.PI - 0.9, Math.PI + 0.5, Math.PI + 0.9]) list.push({ a, r: C.barrier - 0.44, y: BARRIER_H, w: 0.78, h: 1.05, out: false, side: 'b' });
  bannerSpots = list;
  return list;
}
let bannerGeo: THREE.PlaneGeometry | null = null;
let bannerMat: THREE.MeshToonMaterial | null = null;

const Banners: React.FC<{ theme: Theme }> = ({ theme }) => {
  const mesh = useMemo(() => {
    const list = bannerLayout();
    bannerGeo ??= new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0) as THREE.PlaneGeometry;
    if (!bannerMat) {
      bannerMat = toonMaterial(0xffffff, { rim: 0.04, map: bannerTexture(), alphaTest: 0.5, ...opt });
      bannerMat.side = THREE.DoubleSide;
    }
    const im = new THREE.InstancedMesh(bannerGeo, bannerMat, list.length);
    const o = new THREE.Object3D(), col = new THREE.Color();
    list.forEach((b, i) => {
      o.position.set(Math.cos(b.a) * b.r, b.y, Math.sin(b.a) * b.r);
      o.rotation.set(0, b.out ? Math.PI / 2 - b.a : -Math.PI / 2 - b.a, 0);
      o.scale.set(b.w, b.h, 1); o.updateMatrix();
      im.setMatrixAt(i, o.matrix); im.setColorAt(i, col.setHex(b.side === 'a' ? theme.a : theme.b));
    });
    im.castShadow = true;
    return im;
  }, [theme]);
  return <primitive object={mesh} />;
};

/** Bandera ondeando en un mástil (torres y entrada). El mástil y el remate son iguales en todas las sedes. */
let poleMat: THREE.MeshToonMaterial | null = null;
let tipMat: THREE.MeshToonMaterial | null = null;
const Pennant: React.FC<{ x: number; y: number; z: number; color: number; phase: number; size?: number }> = ({ x, y, z, color, phase, size = 1 }) => {
  const flag = useRef<THREE.Mesh>(null);
  const m = useMemo(() => {
    const cloth = toonMaterial(color, { rim: 0.08, ...opt }); cloth.side = THREE.DoubleSide;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.35, 0, 1.3, 0, 0, 0, -0.35, 0], 3));
    geo.computeVertexNormals();
    poleMat ??= toonMaterial(0x6b4526, { rim: 0.03, ...opt });
    tipMat ??= toonMaterial(GOLD, { rim: 0.2, emissive: 0x4a3600, ...opt });
    return { cloth, geo, pole: poleMat, tip: tipMat };
  }, [color]);
  useFrame(({ clock }) => {
    const f = flag.current; if (!f) return;
    const t = clock.elapsedTime + phase;
    f.rotation.y = Math.sin(t * 1.8) * 0.3 + 0.4;
    f.scale.y = 1 + Math.sin(t * 3.1) * 0.06;
  });
  return (
    <group position={[x, y, z]} scale={size}>
      <mesh material={m.pole} position={[0, 0.9, 0]}><cylinderGeometry args={[0.05, 0.06, 1.8, 6]} /></mesh>
      <mesh material={m.tip} position={[0, 1.85, 0]}><sphereGeometry args={[0.1, 8, 6]} /></mesh>
      <mesh ref={flag} geometry={m.geo} material={m.cloth} position={[0, 1.45, 0]} />
    </group>
  );
};

// ---------------------------------------------------------------- fuego

/** Todas las llamas del recinto y del camino: dos InstancedMesh (llama y núcleo) + un Points de brillo. */
const Fires: React.FC<{ fires: Fire[]; light?: [number, number, number] }> = ({ fires, light: lightAt }) => {
  const light = useRef<THREE.PointLight>(null);
  const built = useMemo(() => {
    const N = fires.length;
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a22, transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const outer = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.62, 8).translate(0, 0.31, 0), flameMat, N);
    const inner = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 0.36, 7).translate(0, 0.18, 0), coreMat, N);
    outer.frustumCulled = false; inner.frustumCulled = false;
    const pos = new Float32Array(N * 3);
    fires.forEach((f, i) => { pos[i * 3] = f.x; pos[i * 3 + 1] = f.y + 0.3 * f.s; pos[i * 3 + 2] = f.z; });
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const glowMat = new THREE.PointsMaterial({ map: glowTexture(), size: 2.2, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffa04a, opacity: 0.55 });
    const glow = new THREE.Points(pg, glowMat); glow.frustumCulled = false;
    return { outer, inner, glow, glowMat, seeds: fires.map((_, i) => i * 1.731) };
  }, [fires]);
  const night = useRef(nightness());
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if ((t | 0) % 20 === 0) night.current = nightness();
    const n = night.current;
    fires.forEach((f, i) => {
      const s = built.seeds[i];
      const fl = 1 + Math.sin(t * 13 + s) * 0.1 + Math.sin(t * 7.3 + s * 2) * 0.08;
      o.position.set(f.x, f.y, f.z);
      o.rotation.set(Math.sin(t * 5 + s) * 0.08, t * 0.7 + s, Math.cos(t * 4.2 + s) * 0.08);
      o.scale.set(f.s * (1.05 - (fl - 1) * 0.5), f.s * fl, f.s * (1.05 - (fl - 1) * 0.5));
      o.updateMatrix();
      built.outer.setMatrixAt(i, o.matrix);
      o.scale.multiplyScalar(0.95 + Math.sin(t * 17 + s) * 0.08); o.updateMatrix();
      built.inner.setMatrixAt(i, o.matrix);
    });
    built.outer.instanceMatrix.needsUpdate = true; built.inner.instanceMatrix.needsUpdate = true;
    built.glowMat.size = (1.6 + n * 1.6) * (1 + Math.sin(t * 9) * 0.05);
    built.glowMat.opacity = 0.32 + n * 0.45;
    if (light.current) light.current.intensity = (2 + n * 16) * (1 + Math.sin(t * 11) * 0.05 + Math.sin(t * 6.1) * 0.04);
  });
  return (
    <>
      <primitive object={built.outer} />
      <primitive object={built.inner} />
      <primitive object={built.glow} />
      {/* Una sola luz de punto, la de la sede principal: nueve antorchas con luz real serían nueve luces
          dinámicas sobre cada material del mundo, y el coste de eso no lo paga lo que se ve. */}
      {lightAt && <pointLight ref={light} position={lightAt} distance={30} decay={1.3} color={0xffae5c} intensity={2} />}
    </>
  );
};

// ---------------------------------------------------------------- público (solo durante el combate)

const TUNICS = [0x7b3f2a, 0x3f5d8a, 0x8a7a3a, 0x5b7a3c, 0xa8502f, 0x6d4f82, 0xd9c9a3, 0x2f64c9, 0xc23a2e, 0x4b3a2a];
const SKIN = [0xffe0c4, 0xf2c79e, 0xd9a378, 0xa8744f, 0x7a5236];
const crowdU = { uTime: { value: 0 }, uHype: { value: 0.2 }, uWave: { value: 0 } };

/** Añade al material toon el vaivén del público (saltos con la emoción + la ola), leído en la GPU. */
function crowdify(mat: THREE.MeshToonMaterial) {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base.call(mat, shader, r);
    Object.assign(shader.uniforms, crowdU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed; attribute float aAng; uniform float uTime; uniform float uHype; uniform float uWave;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float crowdJump = uHype * abs(sin(uTime * (5.0 + aSeed * 3.0) + aSeed * 40.0)) * 0.28;
        float crowdIdle = sin(uTime * 1.3 + aSeed * 23.0) * 0.025;
        float crowdWave = uWave * pow(max(0.0, sin(aAng * 2.0 - uTime * 2.6)), 10.0) * 0.5;
        transformed.y += crowdJump + crowdIdle + crowdWave;`);
  };
  mat.customProgramCacheKey = () => 'pg-crowd';
}

const Crowd: React.FC = () => {
  const { body, head } = useMemo(() => {
    const seats: { x: number; y: number; z: number; a: number }[] = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < ROWS; i++) {
      const r = rowR(i) + 0.42;
      const n = Math.floor((TAU * r * S) / 0.6);
      for (let j = 0; j < n; j++) {
        const a = (j / n) * TAU + (i % 2) * 0.02;
        if (fromGate(a) < gapAt(r, GH + 0.9) || j % 16 === 0 || rnd() < 0.1) continue;
        if (i === ROWS - 1 && Math.abs(a - Math.PI / 2) < 0.2) continue; // palco
        seats.push({ x: Math.cos(a) * r * S, y: rowY(i) * S, z: Math.sin(a) * r * S, a });
      }
    }
    const N = seats.length;
    const bodyGeo = new THREE.CapsuleGeometry(0.19, 0.28, 2, 7);
    const headGeo = new THREE.SphereGeometry(0.13, 9, 7);
    const seedAttr = new Float32Array(N), angAttr = new Float32Array(N);
    const bodyM = toonMaterial(0xffffff, { rim: 0.05, ...opt });
    const headM = toonMaterial(0xffffff, { rim: 0.05, ...opt });
    crowdify(bodyM); crowdify(headM);
    const b = new THREE.InstancedMesh(bodyGeo, bodyM, N);
    const h = new THREE.InstancedMesh(headGeo, headM, N);
    const mtx = new THREE.Matrix4(), col = new THREE.Color();
    seats.forEach((s, i) => {
      seedAttr[i] = rnd(); angAttr[i] = s.a;
      mtx.makeTranslation(s.x, s.y + 0.36, s.z); b.setMatrixAt(i, mtx);
      mtx.makeTranslation(s.x, s.y + 0.82, s.z); h.setMatrixAt(i, mtx);
      b.setColorAt(i, col.setHex(TUNICS[(rnd() * TUNICS.length) | 0]));
      h.setColorAt(i, col.setHex(SKIN[(rnd() * SKIN.length) | 0]));
    });
    for (const g of [bodyGeo, headGeo]) {
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedAttr, 1));
      g.setAttribute('aAng', new THREE.InstancedBufferAttribute(angAttr, 1));
    }
    b.frustumCulled = false; h.frustumCulled = false;
    return { body: b, head: h };
  }, []);
  useEffect(() => () => { body.geometry.dispose(); head.geometry.dispose(); }, [body, head]);

  const b = useBattle();
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    crowdU.uTime.value += dt;
    const over = b.turn === 'over' && b.result === 'win';
    const target = over ? 1 : Math.min(1, 0.18 + stage.shake * 2.2);
    const u = crowdU.uHype;
    u.value += (target - u.value) * Math.min(1, dt * (target > u.value ? 10 : 1.4));
    const wave = b.turn === 'intro' || over ? 1 : 0;
    crowdU.uWave.value += (wave - crowdU.uWave.value) * Math.min(1, dt * 1.5);
  });
  if (!b.active) return null;
  return (<><primitive object={body} /><primitive object={head} /></>);
};

// ---------------------------------------------------------------- el camino de llegada (coordenadas del mundo)

interface RoadProp { kind: 'torch' | 'stall' | 'cart' | 'barrel' | 'crate' | 'tent' | 'sign'; x: number; z: number; r: number; color?: number }

function roadLayout(): RoadProp[] {
  const road = PATHS.arena, out: RoadProp[] = [];
  const at = (t: number, off: number) => {
    const p = road.getPointAt(t), tg = road.getTangentAt(t);
    return { x: p.x - tg.z * off, z: p.z + tg.x * off, face: Math.atan2(tg.z * Math.sign(off), -tg.x * Math.sign(off)) };
  };
  [0.1, 0.28, 0.46, 0.64, 0.82].forEach((t, i) => { const p = at(t, i % 2 ? 2.3 : -2.3); out.push({ kind: 'torch', x: p.x, z: p.z, r: 0 }); });
  const s1 = at(0.37, 4.4), s2 = at(0.57, -4.4);
  out.push({ kind: 'stall', x: s1.x, z: s1.z, r: s1.face, color: BLUE }, { kind: 'stall', x: s2.x, z: s2.z, r: s2.face, color: RED });
  const b1 = at(0.43, 3.5), b2 = at(0.51, -3.4), c1 = at(0.32, 3.6);
  out.push({ kind: 'barrel', x: b1.x, z: b1.z, r: 0 }, { kind: 'barrel', x: b2.x, z: b2.z, r: 0.5 }, { kind: 'crate', x: c1.x, z: c1.z, r: 0.4 });
  const cart = at(0.74, 3.6);
  out.push({ kind: 'cart', x: cart.x, z: cart.z, r: cart.face + 1.2 });
  out.push({ kind: 'tent', x: ARENA.x - 20.5, z: ARENA.z + 8.5, r: 0.4, color: BLUE }, { kind: 'tent', x: ARENA.x - 20, z: ARENA.z - 9.5, r: -0.3, color: RED });
  out.push({ kind: 'tent', x: ARENA.x + 4, z: ARENA.z + 20, r: 1, color: GOLD });
  const sp = road.getPointAt(0);
  out.push({ kind: 'sign', x: sp.x + 3.2, z: sp.z - 2.6, r: Math.PI });
  return out;
}

const Approach: React.FC = () => {
  const group = useMemo(() => {
    const root = new THREE.Group();
    const { wood, woodDark, iron } = matsFor(ARENA.theme);
    const signMat = toonMaterial(0xffffff, { rim: 0, map: signTexture(), ...opt });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me;
    };
    const cyl = (r0: number, r1: number, h: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, seg = 10) => {
      const me = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me;
    };
    for (const p of roadLayout()) {
      const g = new THREE.Group();
      const y = heightAt(p.x, p.z);
      g.position.set(p.x, y, p.z); g.rotation.y = p.r;
      if (p.kind === 'torch') {
        cyl(0.07, 0.09, 2.2, woodDark, 0, 1.1, 0, g, 7);
        cyl(0.2, 0.1, 0.24, iron, 0, 2.28, 0, g, 8);
      } else if (p.kind === 'stall') {
        const awn = toonMaterial(0xffffff, { rim: 0, map: stripeTexture('#f3ead2', p.color === BLUE ? '#2f64c9' : '#c23a2e', 8), ...opt });
        for (const sx of [-1.3, 1.3]) for (const sz of [-0.8, 0.8]) cyl(0.06, 0.06, sz < 0 ? 2.3 : 1.9, woodDark, sx, sz < 0 ? 1.15 : 0.95, sz, g, 6);
        box(2.7, 0.8, 0.8, wood, 0, 0.4, 0.45, g);
        const roof = box(3.0, 0.06, 1.95, awn, 0, 2.1, 0, g); roof.rotation.x = -0.22;
        for (let i = 0; i < 3; i++) box(0.34, 0.26, 0.3, i === 1 ? woodDark : wood, -0.7 + i * 0.7, 0.93, 0.45, g);
      } else if (p.kind === 'barrel') {
        cyl(0.34, 0.3, 0.8, wood, 0, 0.4, 0, g, 12);
        cyl(0.355, 0.355, 0.06, iron, 0, 0.62, 0, g, 12); cyl(0.33, 0.33, 0.06, iron, 0, 0.16, 0, g, 12);
      } else if (p.kind === 'crate') {
        box(0.7, 0.7, 0.7, wood, 0, 0.35, 0, g); box(0.5, 0.5, 0.5, woodDark, 0.15, 0.95, 0.05, g).rotation.y = 0.5;
      } else if (p.kind === 'cart') {
        box(1.9, 0.14, 1.1, wood, 0, 0.72, 0, g);
        box(1.9, 0.4, 0.08, woodDark, 0, 0.95, 0.52, g); box(1.9, 0.4, 0.08, woodDark, 0, 0.95, -0.52, g);
        for (const sz of [-0.62, 0.62]) { const w = cyl(0.46, 0.46, 0.1, woodDark, -0.2, 0.46, sz, g, 14); w.rotation.x = Math.PI / 2; }
        for (const sz of [-0.35, 0.35]) { const s = box(1.6, 0.07, 0.07, woodDark, 1.65, 0.5, sz, g); s.rotation.z = 0.28; }
        box(0.6, 0.35, 0.5, toonMaterial(0xd9c9a3, { rim: 0, ...opt }), -0.4, 0.97, 0, g);
      } else if (p.kind === 'tent') {
        const cloth = toonMaterial(0xffffff, { rim: 0, map: stripeTexture('#f3ead2', p.color === BLUE ? '#2f64c9' : p.color === RED ? '#c23a2e' : '#d9a23a', 12), ...opt });
        cyl(1.35, 1.35, 1.5, cloth, 0, 0.75, 0, g, 14);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.5, 14), cloth); roof.position.y = 2.25; roof.castShadow = true; g.add(roof);
        box(0.7, 1.2, 0.05, woodDark, 0, 0.6, 1.34, g);
      } else if (p.kind === 'sign') {
        cyl(0.08, 0.1, 2.1, woodDark, -1.05, 1.05, 0, g, 7); cyl(0.08, 0.1, 2.1, woodDark, 1.05, 1.05, 0, g, 7);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.86), signMat); board.position.set(0, 1.55, 0.06); g.add(board);
        box(2.36, 0.9, 0.08, woodDark, 0, 1.55, 0, g);
      }
      root.add(g);
    }
    return root;
  }, []);
  return <primitive object={group} />;
};

// ---------------------------------------------------------------- recinto completo

/** Braseros sobre la barrera y antorchas en la fachada del portón (coordenadas locales). */
function localFires(): Fire[] {
  const out: Fire[] = [];
  const rb = C.barrier - 0.2;
  for (const a of [0.42, 1.12, 2.02, 2.72, -0.4, -1.1, -2.05, -2.7]) out.push({ x: Math.cos(a) * rb, y: BARRIER_H + 0.42, z: Math.sin(a) * rb, s: 1 });
  const gx = -(C.wall + C.wallT + 0.1);
  for (const z of [GH + 0.7, -GH - 0.7]) out.push({ x: gx, y: G + 3.2, z, s: 0.8 });
  return out;
}

/** Los braseros de hierro bajo las llamas (coordenadas locales, iguales en todas las sedes). */
let brazierGroup: THREE.Group | null = null;
function braziers(): THREE.Group {
  if (brazierGroup) return brazierGroup;
  const iron = matsFor(ARENA.theme).iron;
  const g = new THREE.Group();
  for (const f of localFires()) {
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * f.s, 0.14 * f.s, 0.3 * f.s, 10), iron);
    bowl.position.set(f.x, f.y - 0.12, f.z); g.add(bowl);
    if (f.y < 2) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 6), iron); leg.position.set(f.x, f.y - 0.4, f.z); g.add(leg); }
  }
  brazierGroup = g;
  return g;
}

/**
 * Una sede: el recinto entero, girado y puesto a su cota. El público y el camino de llegada son solo de
 * la principal — en las demás, las gradas vacías son parte de lo que se va a buscar.
 */
const Coliseum: React.FC<{ site: ColiseumSite }> = ({ site }) => {
  const y = arenaY(site);
  const W = C.wall + C.wallT;
  // Cada sede necesita su propio grupo de braseros (un Object3D no puede colgar de dos padres), pero la
  // geometría y el material salen del mismo sitio.
  const bowls = useMemo(() => braziers().clone(), []);
  // Las llamas viven en coordenadas del mundo (no cuelgan del grupo escalado), así que aquí se pasan las
  // posiciones locales por la escala a mano antes de girarlas a su sitio.
  const fires = useMemo(() => {
    const local = localFires().map((f) => {
      const [wx, wz] = toWorld(site, f.x * S, f.z * S);
      return { x: wx, y: f.y * S + y, z: wz, s: f.s * S };
    });
    if (!site.home) return local;
    return [
      ...local,
      ...roadLayout().filter((p) => p.kind === 'torch').map((p) => ({ x: p.x, y: heightAt(p.x, p.z) + 2.38, z: p.z, s: 0.75 })),
    ];
  }, [site, y]);
  return (
    <group>
      <group position={[site.x, y, site.z]} rotation={[0, site.rot, 0]} scale={S}>
        <Masonry theme={site.theme} />
        <Merlons theme={site.theme} />
        <Banners theme={site.theme} />
        <primitive object={bowls} />
        {/* El público va a escala 1 dentro del recinto escalado: las gradas son el doble de grandes, la
            gente no. Por eso el grupo deshace la escala y sus asientos se calculan ya multiplicados. */}
        {site.home && <group scale={1 / S}><Crowd /></group>}
        {TOWERS.map((t, i) => (
          <Pennant key={i} x={t.x} y={t.h + 2.55} z={t.z} color={t.side === 'a' ? site.theme.a : site.theme.b} phase={i * 1.3} />
        ))}
        <Pennant x={-(W + 3.2)} y={G} z={3.6} color={site.theme.a} phase={0.4} size={3.2} />
        <Pennant x={-(W + 3.2)} y={G} z={-3.6} color={site.theme.b} phase={2.1} size={3.2} />
      </group>
      {site.home && <Approach />}
      <Fires fires={fires} light={site.home ? [site.x, y + 5.5, site.z] : undefined} />
    </group>
  );
};

/** El circuito entero: las nueve sedes de la región. */
export const Colosseum: React.FC = () => (
  <group>
    {COLISEUMS.map((site) => <Coliseum key={site.key} site={site} />)}
  </group>
);
