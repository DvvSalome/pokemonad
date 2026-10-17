// Efectos extra de la presentación del combate (cartel VS, crítico, resumen final), sintetizados con
// WebAudio igual que sound.ts. Contexto propio y perezoso: sound.ts no expone el suyo. Respeta el mismo
// silencio (isMuted/subscribeMute), así que la tecla M calla también esto.
import { isMuted, subscribeMute } from './sound';

interface Ctx { ac: AudioContext; out: GainNode; noise: AudioBuffer }
let C: Ctx | null = null;
const VOL = 0.55;

function ctx(): Ctx | null {
  if (C) { if (C.ac.state === 'suspended') void C.ac.resume(); return C; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ac = new AC();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 4;
  const out = ac.createGain(); out.gain.value = isMuted() ? 0 : VOL;
  out.connect(comp).connect(ac.destination);
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  C = { ac, out, noise };
  subscribeMute(() => { if (C) C.out.gain.setTargetAtTime(isMuted() ? 0 : VOL, C.ac.currentTime, 0.05); });
  return C;
}

function env(c: Ctx, t: number, d: number, peak: number, a = 0.005) {
  const g = c.ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  g.connect(c.out);
  return g;
}
function tone(c: Ctx, t: number, f: number, d: number, o: { type?: OscillatorType; g?: number; to?: number } = {}) {
  const osc = c.ac.createOscillator();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
  osc.connect(env(c, t, d, o.g ?? 0.2));
  osc.start(t); osc.stop(t + d + 0.02);
}
function noise(c: Ctx, t: number, d: number, o: { g?: number; f?: number; to?: number; q?: number; type?: BiquadFilterType } = {}) {
  const src = c.ac.createBufferSource();
  src.buffer = c.noise;
  const bq = c.ac.createBiquadFilter();
  bq.type = o.type ?? 'bandpass'; bq.Q.value = o.q ?? 1.2;
  bq.frequency.setValueAtTime(o.f ?? 1200, t);
  if (o.to) bq.frequency.exponentialRampToValueAtTime(o.to, t + d);
  src.connect(bq).connect(env(c, t, d, o.g ?? 0.3, 0.01));
  src.start(t, Math.random() * 0.4); src.stop(t + d + 0.02);
}

const run = (fn: (c: Ctx, t: number) => void, delay = 0) => {
  if (isMuted()) return;
  const c = ctx();
  if (c) fn(c, c.ac.currentTime + delay);
};

export const bsfx = {
  /** Los dos paneles del cartel VS entran barriendo. */
  vsWhoosh: () => run((c, t) => { noise(c, t, 0.42, { f: 400, to: 3200, g: 0.35, q: 0.8 }); }),
  /** El "VS" cae y retumba. */
  vsSlam: () => run((c, t) => {
    tone(c, t, 150, 0.5, { type: 'sine', to: 42, g: 0.7 });
    noise(c, t, 0.25, { f: 900, to: 200, g: 0.45, type: 'lowpass' });
    tone(c, t + 0.02, 880, 0.35, { type: 'square', g: 0.06, to: 660 });
  }),
  /** Crítico: chasquido agudo + campanazo metálico. */
  crit: () => run((c, t) => {
    noise(c, t, 0.12, { f: 5200, g: 0.4, q: 2 });
    tone(c, t, 1320, 0.45, { type: 'square', g: 0.07 });
    tone(c, t, 1980, 0.5, { type: 'triangle', g: 0.12 });
    tone(c, t + 0.06, 2640, 0.4, { type: 'sine', g: 0.08 });
  }),
  /** Una fila del resumen aparece. */
  tick: (i = 0) => run((c, t) => { tone(c, t, 660 * Math.pow(1.06, i), 0.09, { type: 'square', g: 0.05 }); }),
  /** Una estrella del resultado se enciende. */
  star: (i = 0) => run((c, t) => {
    const f = [784, 988, 1175][i % 3];
    tone(c, t, f, 0.5, { type: 'triangle', g: 0.18 });
    tone(c, t, f * 2, 0.35, { type: 'sine', g: 0.06 });
  }),
  /** Salva de confeti de la victoria. */
  confetti: () => run((c, t) => {
    for (let i = 0; i < 5; i++) noise(c, t + i * 0.05, 0.1, { f: 2500 + i * 400, g: 0.18, q: 3 });
  }),
};
