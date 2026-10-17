// Sonido del juego, sintetizado en vivo con WebAudio: no hay archivos de audio que descargar. Una música
// de combate por pasos (bajo, arpegio, melodía y batería de ruido), fanfarrias de victoria y derrota, y
// efectos por tipo de ataque (brasas, burbujas, chispazos, rocas…) más golpes, KO y la bola.
//
// El AudioContext solo puede arrancar tras un gesto del usuario: se crea perezoso en la primera llamada,
// que siempre llega desde un clic o una tecla (el botón de pelear, un ataque).
import type { MonType } from '../world/species';

interface Ctx { ac: AudioContext; master: GainNode; music: GainNode; sfx: GainNode; noise: AudioBuffer }
let C: Ctx | null = null;

const MUTE_KEY = 'pg-mute';
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();
const muteListeners = new Set<() => void>();
const MASTER = 0.8;

function ctx(): Ctx | null {
  if (C) {
    if (C.ac.state === 'suspended') void C.ac.resume();
    return C;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ac = new AC();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  const master = ac.createGain(); master.gain.value = muted ? 0 : MASTER;
  master.connect(comp).connect(ac.destination);
  const music = ac.createGain(); music.gain.value = 0.3; music.connect(master);
  const sfx = ac.createGain(); sfx.gain.value = 0.75; sfx.connect(master);
  const noise = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  C = { ac, master, music, sfx, noise };
  return C;
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* modo privado: solo en memoria */ }
  if (C) C.master.gain.setTargetAtTime(m ? 0 : MASTER, C.ac.currentTime, 0.05);
  muteListeners.forEach((l) => l());
}
export const subscribeMute = (l: () => void) => { muteListeners.add(l); return () => { muteListeners.delete(l); }; };

// ---------------------------------------------------------------- voces

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface ToneOpts { f: number; t: number; d: number; type?: OscillatorType; g?: number; a?: number; r?: number; to?: number; det?: number }
function tone(c: Ctx, dest: AudioNode, o: ToneOpts) {
  const osc = c.ac.createOscillator();
  osc.type = o.type ?? 'square';
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t + o.d);
  if (o.det) osc.detune.value = o.det;
  const g = c.ac.createGain();
  const peak = o.g ?? 0.2, a = o.a ?? 0.005, r = Math.min(o.r ?? 0.05, o.d * 0.8);
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(peak, o.t + a);
  g.gain.setValueAtTime(peak, o.t + Math.max(a, o.d - r));
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.d);
  osc.connect(g).connect(dest);
  osc.start(o.t); osc.stop(o.t + o.d + 0.03);
}

interface NoiseOpts { t: number; d: number; g?: number; f?: number; to?: number; q?: number; type?: BiquadFilterType; a?: number }
function noise(c: Ctx, dest: AudioNode, o: NoiseOpts) {
  const src = c.ac.createBufferSource();
  src.buffer = c.noise; src.loop = true;
  const flt = c.ac.createBiquadFilter();
  flt.type = o.type ?? 'bandpass';
  flt.frequency.setValueAtTime(o.f ?? 1200, o.t);
  if (o.to) flt.frequency.exponentialRampToValueAtTime(o.to, o.t + o.d);
  flt.Q.value = o.q ?? 1;
  const g = c.ac.createGain();
  const peak = o.g ?? 0.3, a = o.a ?? 0.004;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(peak, o.t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.d);
  src.connect(flt).connect(g).connect(dest);
  src.start(o.t, Math.random()); src.stop(o.t + o.d + 0.03);
}

// ---------------------------------------------------------------- música de combate

const BPM = 152;
const STEP = 60 / BPM / 4;
/** Un compás por acorde: Am F G E | F G Am E. */
const BARS: { root: number; arp: number[] }[] = [
  { root: 45, arp: [69, 72, 76] }, { root: 41, arp: [65, 69, 72] }, { root: 43, arp: [67, 71, 74] }, { root: 40, arp: [64, 68, 71] },
  { root: 41, arp: [65, 69, 72] }, { root: 43, arp: [67, 71, 74] }, { root: 45, arp: [69, 72, 76] }, { root: 40, arp: [64, 68, 71] },
];
/** Melodía: por compás, [paso, nota, duración en pasos]. */
const LEAD: [number, number, number][][] = [
  [[0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 71, 2], [8, 69, 4], [12, 72, 2], [14, 76, 2]],
  [[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 72, 6], [14, 74, 2]],
  [[0, 74, 3], [3, 72, 1], [4, 71, 2], [6, 67, 2], [8, 71, 4], [12, 74, 4]],
  [[0, 71, 2], [2, 68, 2], [4, 71, 2], [6, 76, 2], [8, 80, 8]],
  [[0, 81, 4], [4, 77, 2], [6, 76, 2], [8, 72, 4], [12, 77, 4]],
  [[0, 79, 4], [4, 77, 2], [6, 74, 2], [8, 71, 4], [12, 74, 4]],
  [[0, 76, 2], [2, 77, 2], [4, 76, 2], [6, 72, 2], [8, 69, 6], [14, 71, 2]],
  [[0, 72, 2], [2, 71, 2], [4, 68, 2], [6, 71, 2], [8, 64, 8]],
];

let seq: { timer: number; bus: GainNode; next: number; step: number } | null = null;
let danger = false;

function scheduleStep(c: Ctx, bus: GainNode, step: number, t: number) {
  const bar = BARS[Math.floor(step / 16) % BARS.length];
  const s = step % 16;
  // Batería: bombo en 0/8/10, caja en 4/12, charles en los pares.
  if (s === 0 || s === 8 || s === 10) tone(c, bus, { f: 150, to: 42, t, d: 0.16, type: 'sine', g: 0.55, a: 0.002 });
  if (s === 4 || s === 12) {
    noise(c, bus, { t, d: 0.14, f: 1800, q: 0.7, g: 0.28 });
    tone(c, bus, { f: 220, to: 140, t, d: 0.08, type: 'triangle', g: 0.14 });
  }
  if (s % 2 === 0) noise(c, bus, { t, d: s === 14 ? 0.12 : 0.035, f: 8500, type: 'highpass', g: s === 14 ? 0.08 : 0.05 });
  // Bajo en corcheas, saltando de octava.
  if (s % 2 === 0) tone(c, bus, { f: midi(bar.root + (s % 4 === 2 ? 12 : 0)), t, d: STEP * 1.8, type: 'sawtooth', g: 0.11, r: 0.04 });
  // Arpegio suave en semicorcheas.
  tone(c, bus, { f: midi(bar.arp[s % 3] + 12), t, d: STEP * 0.9, type: 'square', g: 0.025 });
  // Melodía, con un segundo oscilador desafinado para engordarla.
  for (const [at, n, len] of LEAD[Math.floor(step / 16) % LEAD.length]) {
    if (at !== s) continue;
    const d = STEP * len * 0.95;
    tone(c, bus, { f: midi(n), t, d, type: 'square', g: 0.06, a: 0.01, r: 0.06 });
    tone(c, bus, { f: midi(n), t, d, type: 'sawtooth', g: 0.03, a: 0.01, r: 0.06, det: 9 });
  }
  // Con poca vida: pitido de alarma en cada tiempo fuerte.
  if (danger && s % 8 === 0) tone(c, bus, { f: midi(88), t, d: 0.09, type: 'square', g: 0.05 });
}

export const music = {
  start() {
    const c = ctx();
    if (!c || seq) return;
    const bus = c.ac.createGain();
    bus.gain.setValueAtTime(0.0001, c.ac.currentTime);
    bus.gain.exponentialRampToValueAtTime(1, c.ac.currentTime + 0.4);
    bus.connect(c.music);
    const st = { timer: 0, bus, next: c.ac.currentTime + 0.05, step: 0 };
    st.timer = window.setInterval(() => {
      while (st.next < c.ac.currentTime + 0.14) {
        scheduleStep(c, bus, st.step, st.next);
        st.step++; st.next += STEP;
      }
    }, 25);
    seq = st;
  },
  stop(fade = 0.5) {
    if (!seq || !C) return;
    const { timer, bus } = seq;
    clearInterval(timer);
    bus.gain.setTargetAtTime(0.0001, C.ac.currentTime, fade / 4);
    setTimeout(() => bus.disconnect(), fade * 1000 + 400);
    seq = null;
    danger = false;
  },
  setDanger(on: boolean) { danger = on; },
  victory() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime + 0.05, dst = c.music;
    const run = [67, 72, 76, 79];
    run.forEach((n, i) => {
      tone(c, dst, { f: midi(n), t: t + i * 0.09, d: 0.1, type: 'square', g: 0.14 });
      tone(c, dst, { f: midi(n - 12), t: t + i * 0.09, d: 0.1, type: 'triangle', g: 0.16 });
    });
    const t2 = t + 0.4;
    for (const n of [72, 76, 79, 84]) tone(c, dst, { f: midi(n), t: t2, d: 1.1, type: 'square', g: 0.07, a: 0.01, r: 0.5 });
    tone(c, dst, { f: midi(48), t: t2, d: 1.1, type: 'triangle', g: 0.25, r: 0.5 });
    const t3 = t2 + 1.2;
    [[81, 0], [83, 0.14], [84, 0.28]].forEach(([n, dt]) => tone(c, dst, { f: midi(n), t: t3 + dt, d: dt === 0.28 ? 0.9 : 0.13, type: 'square', g: 0.11, r: 0.4 }));
    for (const n of [60, 64, 67]) tone(c, dst, { f: midi(n), t: t3 + 0.28, d: 0.9, type: 'triangle', g: 0.12, r: 0.4 });
    noise(c, dst, { t: t3 + 0.28, d: 0.8, f: 7000, type: 'highpass', g: 0.08 });
  },
  defeat() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime + 0.05, dst = c.music;
    [64, 63, 62, 61].forEach((n, i) => tone(c, dst, { f: midi(n), t: t + i * 0.32, d: 0.3, type: 'triangle', g: 0.2, r: 0.1 }));
    tone(c, dst, { f: midi(57), t: t + 1.3, d: 1.4, type: 'triangle', g: 0.22, r: 0.8 });
    tone(c, dst, { f: midi(45), t: t + 1.3, d: 1.4, type: 'sawtooth', g: 0.06, r: 0.8 });
  },
};

// ---------------------------------------------------------------- público del estadio

let crowdBus: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
const CROWD_BASE = 0.05;
/** Murmullo continuo del estadio (ruido filtrado en la banda de las voces) que se dispara con los golpes. */
export const crowd = {
  start() {
    const c = ctx();
    if (!c || crowdBus) return;
    const src = c.ac.createBufferSource(); src.buffer = c.noise; src.loop = true;
    const lo = c.ac.createBiquadFilter(); lo.type = 'bandpass'; lo.frequency.value = 700; lo.Q.value = 0.6;
    const gain = c.ac.createGain(); gain.gain.setValueAtTime(0.0001, c.ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(CROWD_BASE, c.ac.currentTime + 1.2);
    src.connect(lo).connect(gain).connect(c.sfx);
    src.start();
    crowdBus = { src, gain };
  },
  /** Ovación momentánea: sube y vuelve al murmullo. */
  swell(k = 1) {
    if (!crowdBus || !C) return;
    const g = crowdBus.gain.gain, t = C.ac.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(CROWD_BASE + 0.22 * k, t, 0.08);
    g.setTargetAtTime(CROWD_BASE, t + 0.5 + k * 0.6, 0.5);
  },
  stop() {
    if (!crowdBus || !C) return;
    const { src, gain } = crowdBus;
    gain.gain.cancelScheduledValues(C.ac.currentTime);
    gain.gain.setTargetAtTime(0.0001, C.ac.currentTime, 0.25);
    setTimeout(() => { try { src.stop(); } catch { /* ya parado */ } gain.disconnect(); }, 1500);
    crowdBus = null;
  },
};

// ---------------------------------------------------------------- efectos

/** Cada tipo tiene su sonido al cargar/lanzar el ataque. */
function castFor(c: Ctx, type: MonType, t: number) {
  const o = c.sfx;
  switch (type) {
    case 'Fire':
      noise(c, o, { t, d: 0.62, f: 500, to: 2400, q: 0.8, g: 0.35, a: 0.08, type: 'lowpass' });
      tone(c, o, { f: 90, to: 260, t, d: 0.6, type: 'sawtooth', g: 0.07, a: 0.05 });
      break;
    case 'Water':
      for (let i = 0; i < 7; i++) {
        const f = 500 + Math.random() * 700;
        tone(c, o, { f, to: f * 2.2, t: t + i * 0.075, d: 0.07, type: 'sine', g: 0.16 });
      }
      noise(c, o, { t, d: 0.6, f: 900, to: 2600, q: 1.5, g: 0.14, a: 0.1 });
      break;
    case 'Electric':
      for (let i = 0; i < 9; i++) noise(c, o, { t: t + i * 0.055 + Math.random() * 0.02, d: 0.035, f: 3000 + Math.random() * 3000, q: 3, g: 0.22 });
      tone(c, o, { f: 110, to: 880, t, d: 0.6, type: 'square', g: 0.05, a: 0.04 });
      break;
    case 'Grass':
      noise(c, o, { t, d: 0.55, f: 3500, to: 6000, q: 0.6, g: 0.2, a: 0.1 });
      tone(c, o, { f: 660, to: 990, t: t + 0.1, d: 0.35, type: 'triangle', g: 0.07 });
      break;
    case 'Ice':
      for (let i = 0; i < 6; i++) tone(c, o, { f: midi(88 + ((i * 5) % 12)), t: t + i * 0.08, d: 0.25, type: 'sine', g: 0.08, r: 0.2 });
      noise(c, o, { t, d: 0.5, f: 6000, type: 'highpass', g: 0.08, a: 0.1 });
      break;
    case 'Rock': case 'Ground':
      noise(c, o, { t, d: 0.62, f: 180, to: 90, type: 'lowpass', q: 1, g: 0.5, a: 0.1 });
      tone(c, o, { f: 70, to: 40, t, d: 0.6, type: 'triangle', g: 0.2, a: 0.1 });
      break;
    case 'Psychic': case 'Fairy': case 'Ghost': case 'Dark': {
      const base = type === 'Fairy' ? 880 : type === 'Psychic' ? 520 : 260;
      for (let i = 0; i < 3; i++) tone(c, o, { f: base * (1 + i * 0.5), to: base * (1.6 + i * 0.5), t: t + i * 0.06, d: 0.55, type: 'sine', g: 0.07, a: 0.08, det: i * 12 });
      break;
    }
    case 'Dragon':
      tone(c, o, { f: 70, to: 180, t, d: 0.62, type: 'sawtooth', g: 0.14, a: 0.1 });
      tone(c, o, { f: 72, to: 185, t, d: 0.62, type: 'sawtooth', g: 0.14, a: 0.1, det: 25 });
      noise(c, o, { t, d: 0.62, f: 400, to: 1600, q: 1, g: 0.2, a: 0.15 });
      break;
    case 'Poison':
      for (let i = 0; i < 5; i++) tone(c, o, { f: 180 + Math.random() * 120, to: 90, t: t + i * 0.1, d: 0.12, type: 'sine', g: 0.14 });
      break;
    case 'Flying':
      noise(c, o, { t, d: 0.6, f: 600, to: 3000, q: 2, g: 0.28, a: 0.15 });
      break;
    default:
      // Golpes físicos: impulso y embestida.
      noise(c, o, { t: t + 0.18, d: 0.4, f: 400, to: 2600, q: 1.2, g: 0.3, a: 0.2 });
  }
}

export const sfx = {
  ui() { const c = ctx(); if (c) tone(c, c.sfx, { f: 880, to: 1320, t: c.ac.currentTime, d: 0.06, type: 'square', g: 0.06 }); },
  wipe() {
    const c = ctx(); if (!c) return;
    noise(c, c.sfx, { t: c.ac.currentTime, d: 0.55, f: 300, to: 5000, q: 1.4, g: 0.3, a: 0.2 });
  },
  appear() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    noise(c, c.sfx, { t, d: 0.5, f: 2500, to: 700, q: 0.8, g: 0.22 });
    tone(c, c.sfx, { f: 180, to: 90, t, d: 0.3, type: 'triangle', g: 0.2 });
  },
  throwBall() {
    const c = ctx(); if (!c) return;
    noise(c, c.sfx, { t: c.ac.currentTime, d: 0.45, f: 700, to: 2200, q: 3, g: 0.2, a: 0.1 });
  },
  pop() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    tone(c, c.sfx, { f: 300, to: 1400, t, d: 0.12, type: 'square', g: 0.12 });
    for (let i = 0; i < 4; i++) tone(c, c.sfx, { f: midi(84 + i * 4), t: t + 0.06 + i * 0.05, d: 0.18, type: 'sine', g: 0.08 });
    noise(c, c.sfx, { t, d: 0.2, f: 4000, q: 0.8, g: 0.15 });
  },
  cast(type: MonType) { const c = ctx(); if (c) castFor(c, type, c.ac.currentTime); },
  /** Al tocar. `strong` = súper eficaz; `ko` = el golpe que lo tumba (con cola grave larga). */
  hit(strong: boolean, ko: boolean) {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime, o = c.sfx;
    tone(c, o, { f: strong ? 190 : 160, to: 38, t, d: 0.26, type: 'sine', g: 0.8, a: 0.002 });
    noise(c, o, { t, d: 0.18, f: 1400, to: 300, q: 0.6, g: 0.5 });
    if (strong || ko) {
      noise(c, o, { t, d: 0.35, f: 3200, to: 900, q: 0.5, g: 0.35 });
      tone(c, o, { f: 1480, t: t + 0.01, d: 0.4, type: 'triangle', g: 0.08, r: 0.35 });
    }
    if (ko) {
      tone(c, o, { f: 120, to: 26, t: t + 0.02, d: 1.6, type: 'sine', g: 0.7, r: 1.2 });
      noise(c, o, { t: t + 0.02, d: 1.8, f: 800, to: 120, type: 'lowpass', g: 0.45, a: 0.01 });
    }
  },
  miss() {
    const c = ctx(); if (!c) return;
    noise(c, c.sfx, { t: c.ac.currentTime, d: 0.25, f: 2600, to: 900, q: 2, g: 0.18 });
  },
  /** Aviso "¡súper eficaz!": dos notas que suben. */
  sting() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    tone(c, c.sfx, { f: midi(79), t, d: 0.09, type: 'square', g: 0.09 });
    tone(c, c.sfx, { f: midi(86), t: t + 0.09, d: 0.2, type: 'square', g: 0.09, r: 0.12 });
  },
  // ---- captura en el mundo ----
  /** Silbido del lanzamiento, que sube de tono con el giro. */
  capThrow() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    noise(c, c.sfx, { t, d: 0.5, f: 500, to: 2600, q: 2.4, g: 0.16, a: 0.12 });
    for (let i = 0; i < 4; i++) noise(c, c.sfx, { t: t + 0.08 + i * 0.1, d: 0.06, f: 1800 + i * 300, q: 5, g: 0.05 });
  },
  /** Impacto + la bola se abre: golpe seco y un brillo que sube. */
  capOpen() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    tone(c, c.sfx, { f: 520, to: 200, t, d: 0.08, type: 'triangle', g: 0.22, a: 0.002 });
    noise(c, c.sfx, { t, d: 0.09, f: 3000, q: 1, g: 0.16 });
    tone(c, c.sfx, { f: midi(76), to: midi(88), t: t + 0.16, d: 0.3, type: 'sine', g: 0.07, a: 0.03 });
  },
  /** El monstruo convertido en luz entra en la bola: barrido que baja y se estrecha. */
  capAbsorb() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    noise(c, c.sfx, { t, d: 0.75, f: 5200, to: 600, q: 3.5, g: 0.13, a: 0.2 });
    tone(c, c.sfx, { f: midi(91), to: midi(67), t, d: 0.7, type: 'sine', g: 0.07, a: 0.15, r: 0.2 });
    tone(c, c.sfx, { f: midi(91), to: midi(67), t, d: 0.7, type: 'sine', g: 0.05, a: 0.15, r: 0.2, det: 14 });
  },
  /** La tapa se cierra de golpe. */
  capSnap() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    tone(c, c.sfx, { f: 1500, to: 700, t, d: 0.04, type: 'square', g: 0.07, a: 0.001 });
    noise(c, c.sfx, { t, d: 0.05, f: 4200, q: 2, g: 0.14 });
  },
  /** La bola toca el suelo. `soft` = el rebote pequeño. */
  capLand(soft = false) {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    tone(c, c.sfx, { f: soft ? 150 : 120, to: 55, t, d: soft ? 0.1 : 0.18, type: 'sine', g: soft ? 0.18 : 0.38, a: 0.002 });
    noise(c, c.sfx, { t, d: soft ? 0.06 : 0.12, f: 900, to: 300, q: 0.8, g: soft ? 0.08 : 0.16 });
  },
  /** Cada temblor: traqueteo corto y un "bip" del botón, más agudo en cada uno. */
  capWobble(i: number) {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    for (let k = 0; k < 3; k++) noise(c, c.sfx, { t: t + k * 0.075, d: 0.04, f: 1500 + k * 200, q: 3, g: 0.07 });
    tone(c, c.sfx, { f: midi(72 + i * 2), t: t + 0.02, d: 0.09, type: 'square', g: 0.035 });
  },
  /** ¡Clic! de cierre y un arpegio brillante. */
  capClick() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    tone(c, c.sfx, { f: 2400, to: 1200, t, d: 0.03, type: 'square', g: 0.12, a: 0.001 });
    noise(c, c.sfx, { t, d: 0.04, f: 5000, q: 2, g: 0.2 });
    [79, 83, 86, 91, 95].forEach((n, i) => tone(c, c.sfx, { f: midi(n), t: t + 0.12 + i * 0.07, d: 0.35, type: 'triangle', g: 0.07, r: 0.25 }));
    for (let i = 0; i < 6; i++) tone(c, c.sfx, { f: midi(96 + (i % 3) * 3), t: t + 0.5 + i * 0.06, d: 0.12, type: 'sine', g: 0.03 });
  },
  /** La bola revienta y el monstruo sale. */
  capBurst() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    tone(c, c.sfx, { f: 220, to: 900, t, d: 0.12, type: 'square', g: 0.1, a: 0.002 });
    noise(c, c.sfx, { t, d: 0.4, f: 2400, to: 500, q: 0.8, g: 0.28 });
    tone(c, c.sfx, { f: midi(84), to: midi(72), t: t + 0.05, d: 0.35, type: 'sine', g: 0.06 });
  },
  /** Refunfuño del monstruo que se escapó. */
  capGrumble() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    for (let i = 0; i < 3; i++) tone(c, c.sfx, { f: 150 - i * 12, to: 110 - i * 10, t: t + i * 0.11, d: 0.1, type: 'sawtooth', g: 0.05 });
  },
  /** Público del estadio: ovación de ruido filtrado que crece y se apaga. */
  cheer() {
    const c = ctx(); if (!c) return;
    const t = c.ac.currentTime;
    for (let i = 0; i < 3; i++) noise(c, c.sfx, { t: t + i * 0.05, d: 2.2, f: 900 + i * 700, q: 0.7, g: 0.12, a: 0.35 });
    for (let i = 0; i < 10; i++) noise(c, c.sfx, { t: t + 0.2 + Math.random() * 1.4, d: 0.05, f: 2500, q: 4, g: 0.1 });
  },
};
