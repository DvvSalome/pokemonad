// Captura de metraje del juego para el teaser.
//
// Abre el dev server con Chrome real (GPU), fija la hora a la dorada, mete al jugador donde toca y graba
// cada plano con Page.startScreencast. Cada plano sale a out/shots/<nombre>/ como jpgs + list.txt con la
// duracion real de cada frame, para que ffmpeg lo pase a 30 fps sin inventarse el ritmo.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:3000/';
const OUT = path.resolve('out/shots');
const W = Number(process.env.CW || 1280), H = Number(process.env.CH || 720);

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- planos

/**
 * Cada plano: nombre, segundos de grabacion, `hud` (true = interfaz del juego a la vista),
 * `setup` (codigo en la pagina, antes de grabar) y `cam` (animacion de camara durante la toma).
 */
const SHOTS = [
  {
    name: '01-meadow-orbit', secs: 7, hud: false,
    setup: `__warp(2, 6); __orbit(Math.PI * 0.15, 0.30, 13); await __wait(1200);`,
    cam: `__drift({ yaw: 0.30, pitch: -0.03, dist: 3.5 })`,
  },
  {
    name: '02-walk', secs: 7, hud: true,
    setup: `__warp(-6, 24); __orbit(Math.PI * 0.98, 0.55, 15); await __wait(900);`,
    key: 'w',
    cam: `__drift({ yaw: 0.22, pitch: -0.08, dist: -2 })`,
  },
  {
    name: '03-region', secs: 5, hud: true,
    setup: `__warp(10, 30); __orbit(Math.PI * 1.2, 0.9, 20); await __wait(600); __click('.pg-minimap2'); await __wait(500);`,
    cam: `__drift({ yaw: 0.10, pitch: 0, dist: 0 })`,
  },
  {
    name: '04-coliseum', secs: 8, hud: false,
    setup: `__click('.pg-regionmap .x'); await __wait(400); __look(6, 45, 30, 45, 24, 0.33); await __wait(1800);`,
    cam: `__drift({ yaw: 0.22, pitch: 0.05, dist: -3 })`,
  },
  {
    name: '05-mart', secs: 6, hud: true,
    setup: `__click('.ex-shop-btn'); await __wait(900);`,
  },
  {
    name: '06-professor', secs: 6, hud: true,
    setup: `__click('.ex-shop header button'); await __wait(500); __look(25.7, 9.5, 25.7, 3.2, 9, 0.28); await __wait(1500);`,
    cam: `__drift({ yaw: 0.22, pitch: 0.03, dist: -1.6 })`,
  },
  {
    name: '07-catch-aim', secs: 5, hud: true,
    setup: `__g.cap.startEncounter('prof-meadow-2'); await __wait(1400); if (!__g.cap.getActiveId()) throw new Error('el encuentro no arranco');`,
  },
  {
    name: '08-catch-seal', secs: 6, hud: true,
    setup: `window.__forceCatch = [true, 3]; __g.cap.selectBall('hood'); __g.cap.throwBall(); await __wait(300);`,
  },
  {
    name: '09-lecture', secs: 10, hud: true,
    setup: `await __wait(1200);`,
  },
  {
    name: '10-gate', secs: 6, hud: true,
    // La puerta se habla en la puerta: la camara se planta delante del coliseo antes de abrir el panel.
    setup: `__g.cap.endEncounter(); await __wait(300); __look(6, 45, 30, 45, 24, 0.33); await __wait(1400);
      __g.ac.openGate(); await __wait(900);`,
  },
  {
    name: '11-roster', secs: 5, hud: true,
    setup: `__g.ac.enterAsGuest(); await __wait(900);`,
  },
  {
    name: '12-battle-intro', secs: 8, hud: true,
    setup: `__g.ac.startBattle(0); await __wait(900);`,
  },
  {
    name: '13-battle-wrong', secs: 9, hud: true,
    setup: `await __wait(600); __answer(false); await __wait(2600);`,
  },
  {
    // El golpe bueno: se responde bien y se graba el impacto, no el final de la pelea.
    name: '14-battle-win', secs: 4, hud: true,
    setup: `__g.ac.nextTurn(); await __wait(1100); __answer(true); await __wait(120);`,
  },
  {
    // El panel de la insignia mide mas que una ventana de 720 px y se corta por arriba: para el rodaje
    // se encoge un pelin, que es cosa del encuadre y no del juego.
    name: '15-badge', secs: 7, hud: true,
    setup: `await __wait(600); await __win(); await __wait(1200);
      const st = document.createElement('style');
      st.textContent = '.mon-layer .mon-result{max-height:none;overflow:visible;position:fixed;left:50%;top:50%;'
        + 'transform:translate(-50%,-50%) scale(.88)}';
      document.head.appendChild(st); await __wait(400);`,
  },
];

// ---------------------------------------------------------------- utilidades de pagina

const PAGE_HELPERS = `
// Vite sirve los modulos con ?t=... cuando ha habido HMR. Importar la ruta pelada crearia una SEGUNDA
// instancia del store y el juego no se enteraria de nada: hay que importar la misma URL que cargo la app.
window.__mod = (p) => {
  const hit = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop();
  return import(hit || p);
};
window.__g = {
  w: await __mod('/src/world/wildStore.ts'),
  c: await __mod('/src/world/cameraStore.ts'),
  cap: await __mod('/src/world/captureStore.ts'),
  prof: await __mod('/src/world/professors.ts'),
  ac: await __mod('/src/academy/academyStore.ts'),
};
window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
window.__warp = (x, z) => __g.w.warpTo(x, z);
window.__warpToProf = (id, back) => {
  const p = __g.prof.PROFESSORS.find((s) => s.id === id);
  __g.w.warpTo(p.x, p.z + (back || 5));
  return { x: p.x, z: p.z };
};
window.__orbit = (yaw, pitch, dist) => {
  __g.c.orbit.yaw = yaw; __g.c.orbit.pitch = pitch; __g.c.orbit.distance = dist;
  __g.c.camCtl.cut = true;
};
window.__click = (sel) => { const el = document.querySelector(sel); if (el) el.click(); };
window.__esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
/** Planta al jugador en (px,pz) y apunta la camara hacia (tx,tz): camara - jugador - objetivo. */
window.__look = (px, pz, tx, tz, dist, pitch) => {
  __g.w.warpTo(px, pz);
  const dx = tx - px, dz = tz - pz, l = Math.hypot(dx, dz) || 1;
  __orbit(Math.atan2(-dx / l, -dz / l), pitch, dist);
};
window.__stopCam = () => { if (window.__camRaf) cancelAnimationFrame(window.__camRaf); window.__camRaf = 0; };
/** Deriva lenta de camara durante toda la toma: el movimiento continuo es lo que la hace cine. */
window.__drift = (d) => {
  __stopCam();
  const o = __g.c.orbit;
  const y0 = o.yaw, p0 = o.pitch, d0 = o.distance, t0 = performance.now();
  const step = () => {
    const t = (performance.now() - t0) / 1000;
    o.yaw = y0 + (d.yaw || 0) * t * 0.1;
    o.pitch = Math.max(0.22, Math.min(1.25, p0 + (d.pitch || 0) * t * 0.1));
    o.distance = Math.max(6, Math.min(30, d0 + (d.dist || 0) * t * 0.1));
    window.__camRaf = requestAnimationFrame(step);
  };
  window.__camRaf = requestAnimationFrame(step);
};
/** Responde la pregunta en curso: bien o mal a proposito. */
window.__answer = (ok) => {
  const b = __g.ac.getAcademy().battle;
  if (!b) return;
  const right = b.queue[b.i].answer;
  __g.ac.answer(ok ? right : (right + 1) % b.queue[b.i].options.length);
};
/** Tumba al jefe acertando seguido, dejando que cada golpe se vea. */
window.__win = async () => {
  for (let n = 0; n < 12; n++) {
    const st = __g.ac.getAcademy().battle;
    if (!st || st.turn === 'over') return;
    if (st.turn === 'ask') { __answer(true); await __wait(2200); }
    else if (st.turn === 'verdict') { __g.ac.nextTurn(); await __wait(900); }
    else await __wait(400);
  }
};
window.__hud = (on) => {
  let el = document.getElementById('cine-hud');
  if (!el) { el = document.createElement('style'); el.id = 'cine-hud'; document.head.appendChild(el); }
  el.textContent = on ? '' : '#root > *:not(:first-child) { display: none !important; }';
};
'ready'`;

// ---------------------------------------------------------------- grabacion

async function record(page, client, dir, secs) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = async ({ data, sessionId, metadata }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    frames.push({ file, ts: metadata.timestamp });
    try { await client.send('Page.screencastFrameAck', { sessionId }); } catch { /* cerrado */ }
  };
  client.on('Page.screencastFrame', onFrame);
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(secs * 1000);
  await client.send('Page.stopScreencast');
  client.off('Page.screencastFrame', onFrame);

  const list = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    const dur = next ? Math.max(0.008, Math.min(0.5, next.ts - f.ts)) : 1 / 30;
    list.push(`file '${f.file}'\nduration ${dur.toFixed(4)}`);
  });
  if (frames.length) list.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
  return frames.length;
}

// ---------------------------------------------------------------- main

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  userDataDir: path.resolve('.chrome'),
  args: [
    '--window-size=1300,820', '--window-position=0,0', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
  ],
});

const page = (await browser.pages())[0];
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

// Hora dorada fija: el ciclo dia/noche del juego lee new Date() en cada frame.
await page.evaluateOnNewDocument(() => {
  const H = 18, M = 10;
  Date.prototype.getHours = function () { return H; };
  Date.prototype.getMinutes = function () { return M; };
  try {
    localStorage.clear();            // partida limpia en cada rodaje: si el profesor ya esta cazado, no hay clase
    localStorage.setItem('pg-lang', 'es');
  } catch { /* sin storage */ }
});

// macOS throttla las ventanas tapadas: Chrome tiene que estar delante durante toda la grabacion.
const front = () => { try { require('node:child_process').execSync('osascript -e \'tell application "Google Chrome" to activate\''); } catch { /* da igual */ } };
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
front();
await sleep(22000); // carga de modelos (el avatar tarda en llegar: sin esto el jugador sale de fantasma)
await page.evaluate(`(async () => { ${PAGE_HELPERS} })()`);
await page.evaluate(async () => {
  const i18n = await window.__mod('/src/i18n/index.ts');
  i18n.setLang('es');
});
await sleep(1500);

const fps = await page.evaluate(async () => {
  let n = 0; const t0 = performance.now();
  await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  return Math.round(n / ((performance.now() - t0) / 1000));
});
console.log(`fps del juego: ${fps}`);

const client = await page.target().createCDPSession();
fs.mkdirSync(OUT, { recursive: true });

for (const shot of SHOTS) {
  if (only.length && !only.some((o) => shot.name.includes(o))) continue;
  process.stdout.write(`· ${shot.name} … `);
  await page.evaluate((on) => window.__hud(on), !!shot.hud);
  await page.evaluate(`(async () => { window.__stopCam(); ${shot.setup || ''} })()`);
  if (shot.cam) await page.evaluate(`(() => { ${shot.cam}; })()`);
  // Algun boton se lleva el foco y arrastra la pagina: sin esto el panel final sale cortado por arriba.
  await page.evaluate(() => { window.scrollTo(0, 0); document.scrollingElement.scrollTop = 0; });
  if (shot.key) await page.keyboard.down(shot.key);
  const n = await record(page, client, path.join(OUT, shot.name), shot.secs);
  if (shot.key) await page.keyboard.up(shot.key);
  await page.evaluate(() => window.__stopCam());
  console.log(`${n} frames`);
}

await browser.close();
console.log('listo');
