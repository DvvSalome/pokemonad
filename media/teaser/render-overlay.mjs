// Dibuja la capa de rotulos, fotograma a fotograma, en PNG con transparencia.
//
// Nada de grabar en tiempo real: se le pide a la pagina el segundo exacto de cada fotograma y se
// fotografia. Asi el rotulo entra siempre en el mismo sitio, aunque el render vaya lento.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('out');
const DIR = path.join(OUT, 'overlay');
const TL = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline.json'), 'utf8'));
const FRAMES = Math.round(TL.total * TL.fps);

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: TL.w, height: TL.h, deviceScaleFactor: 1 },
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});
const page = (await browser.pages())[0];
await page.goto('file://' + path.resolve('overlay.html'), { waitUntil: 'load' });
await page.evaluate((tl) => window.setTimeline(tl), TL);
await new Promise((r) => setTimeout(r, 500)); // que carguen las tipografias

const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) {
  await page.evaluate((t) => window.render(t), f / TL.fps);
  await page.screenshot({
    path: path.join(DIR, `${String(f + 1).padStart(5, '0')}.png`),
    omitBackground: true,
    optimizeForSpeed: true,
  });
  if (f % 150 === 0) process.stdout.write(`  ${f}/${FRAMES} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}
await browser.close();
console.log(`rotulos listos: ${FRAMES} fotogramas`);
