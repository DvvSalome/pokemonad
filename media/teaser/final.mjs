// Pega los rotulos sobre el corte, echa el grano al conjunto y le pone la cama de sonido.
//
// El grano va aqui, al final, para que caiga tambien sobre el texto: si se metiera antes, los rotulos
// quedarian limpios encima de una imagen sucia y se notaria que son de otra capa.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.resolve('out');
const TL = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline.json'), 'utf8'));
const D = TL.total;
const END = TL.clips[TL.clips.length - 1].start; // donde entra el negro de la marca

/**
 * Cama de sonido: un acorde grave quieto (la, mi, la, mi) con las dos mitades del estereo desafinadas
 * medio hercio, que es lo que lo hace respirar, mas aire de ruido marron. Al entrar la marca cae un
 * golpe grave. Nada melodico a proposito: es ambiente, no musica.
 */
const PAD_L = "0.085*sin(2*PI*55*t)+0.060*sin(2*PI*82.41*t)+0.040*sin(2*PI*110*t)+0.022*sin(2*PI*164.81*t)";
const PAD_R = "0.085*sin(2*PI*55.4*t)+0.060*sin(2*PI*82.9*t)+0.040*sin(2*PI*110.6*t)+0.022*sin(2*PI*165.4*t)";
const BOOM = "0.42*sin(2*PI*46*t)*exp(-2.6*t)+0.18*sin(2*PI*92*t)*exp(-5*t)";

const audio = [
  `aevalsrc='${PAD_L}|${PAD_R}':s=48000:d=${D}[pad]`,
  `anoisesrc=color=brown:amplitude=0.05:duration=${D}:sample_rate=48000,aformat=channel_layouts=stereo,lowpass=f=1400,volume=0.35[air]`,
  `aevalsrc='${BOOM}|${BOOM}':s=48000:d=4,adelay=${Math.round(END * 1000)}|${Math.round(END * 1000)},apad=whole_dur=${D}[boom]`,
  `[pad]tremolo=f=0.12:d=0.35,lowpass=f=760,volume=0.9[padf]`,
  `[padf][air][boom]amix=inputs=3:normalize=0:duration=longest,`
  + `afade=t=in:st=0:d=3.5,afade=t=out:st=${(D - 4).toFixed(2)}:d=4,`
  + `volume=1.6,alimiter=limit=0.82[a]`,
].join(';');

const video = `[0:v][1:v]overlay=format=auto:eof_action=pass,`
  + `noise=alls=7:allf=t+u,`
  + `fade=t=out:st=${(D - 1.2).toFixed(2)}:d=1.2[v]`;

execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning',
  '-i', path.join(OUT, 'base.mp4'),
  '-framerate', String(TL.fps), '-i', path.join(OUT, 'overlay', '%05d.png'),
  '-filter_complex', `${video};${audio}`,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-level', '4.0', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
  path.join(OUT, 'pokemonad-teaser.mp4')], { stdio: 'inherit' });

console.log('listo: out/pokemonad-teaser.mp4');
