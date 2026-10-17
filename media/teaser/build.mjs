// Monta el corte base: recorta cada plano, los encadena con fundidos y le mete el etalonaje.
//
// Sale out/base.mp4 (imagen ya tratada, sin rotulos) y out/timeline.json con el instante en el que
// entra cada plano, que es lo que usa el rotulador para no descuadrarse.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CLIPS, XFADE, FPS, W, H } from './timeline.mjs';

const OUT = path.resolve('out');
const SHOTS = path.join(OUT, 'shots');
const CLIPDIR = path.join(OUT, 'clips');
fs.mkdirSync(CLIPDIR, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });

// ---------------------------------------------------------------- 1. cada plano por separado

/** Zoom lentisimo para los planos de interfaz, que no tienen movimiento propio. */
const push = `scale=${W * 2}:${H * 2}:flags=lanczos,zoompan=z='min(1+0.00040*on,1.10)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`;

CLIPS.forEach((c, i) => {
  const dst = path.join(CLIPDIR, `${String(i).padStart(2, '0')}.mp4`);
  if (!c.shot) {
    ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${c.dur}`,
      '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', dst]);
    return;
  }
  const list = path.join(SHOTS, c.shot, 'list.txt');
  const vf = c.push
    ? `fps=${FPS},${push},setsar=1`
    : `fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1`;
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-ss', String(c.in), '-t', String(c.dur),
    '-vf', vf, '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', dst]);
  process.stdout.write(`· ${c.shot} ✓\n`);
});

// ---------------------------------------------------------------- 2. encadenado

const inputs = CLIPS.flatMap((_, i) => ['-i', path.join(CLIPDIR, `${String(i).padStart(2, '0')}.mp4`)]);
const starts = [];
let acc = 0;
const steps = [];
let prev = '0:v';
CLIPS.forEach((c, i) => {
  if (i === 0) { starts.push(0); acc += c.dur; return; }
  // En xfade el segundo plano empieza su propio tiempo justo en `offset`: ahi arranca el plano i.
  const off = acc - XFADE;
  starts.push(off);
  const lbl = `x${i}`;
  steps.push(`[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${off.toFixed(3)}[${lbl}]`);
  prev = lbl;
  acc += c.dur - XFADE;
});
const TOTAL = acc;

/**
 * Etalonaje: menos saturacion, negros levantados en calido, altas luces doradas, aberracion cromatica
 * de un pixel, vineta cerrada y grano. Es lo que lleva la paleta del juego al sitio del video de
 * referencia sin apagarla del todo.
 */
const GRADE = [
  'eq=saturation=0.80:contrast=1.07:brightness=-0.015',
  "curves=r='0/0.055 0.25/0.26 0.5/0.53 1/1':g='0/0.045 0.25/0.24 0.5/0.50 1/0.975':b='0/0.065 0.25/0.23 0.5/0.455 1/0.90'",
  'rgbashift=rh=1:bh=-1',
  'vignette=angle=PI/3.6',
].join(',');  // el grano se echa al final, una vez, sobre los rotulos tambien

const filter = [...steps, `[${prev}]${GRADE},fade=t=in:st=0:d=1.0[v]`].join(';');

ff([...inputs, '-filter_complex', filter, '-map', '[v]',
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  path.join(OUT, 'base.mp4')]);

fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({
  fps: FPS, w: W, h: H, total: TOTAL, xfade: XFADE,
  clips: CLIPS.map((c, i) => ({ shot: c.shot, start: starts[i], dur: c.dur, caps: c.caps })),
}, null, 2));

console.log(`base.mp4 listo · ${TOTAL.toFixed(2)}s`);
