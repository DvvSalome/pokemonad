# Teaser · cómo se rehace

El vídeo (`../pokemonad-teaser.mp4`) no es una grabación de pantalla: se rueda solo. Cuatro pasos,
en este orden, con el `npm run dev` levantado en el puerto 3000 y `npm i puppeteer-core` en esta carpeta.

1. `node capture.mjs` — abre el juego en Chrome, fija la hora dorada, coloca al jugador y al coliseo
   plano a plano y graba cada toma en `out/shots/<plano>/` (jpgs + `list.txt` con la duración real de
   cada fotograma). Acepta filtros: `node capture.mjs 10- 11-` rueda solo esos planos.
2. `node build.mjs` — recorta cada plano según `timeline.mjs`, los encadena con fundidos y aplica el
   etalonaje. Sale `out/base.mp4` y `out/timeline.json`.
3. `node render-overlay.mjs` — dibuja los rótulos (`overlay.html`) fotograma a fotograma en PNG con alfa.
4. `node final.mjs` — pega rótulos, echa el grano y monta la cama de sonido.

**El guion vive en `timeline.mjs`**: qué plano entra, cuánto dura y qué se lee encima. Cambiar el texto
—o traducirlo— es tocar ese archivo y repetir los pasos 2 a 4; no hace falta volver a rodar.

Dos cosas que el rodaje tiene que forzar y conviene saber:

- Vite sirve los módulos con `?t=...` cuando ha habido HMR. `capture.mjs` importa **la misma URL que
  cargó la app** (ver `__mod`); importar la ruta pelada crea una segunda instancia del store y el juego
  no se entera de nada.
- El panel de la insignia (`.mon-result`) mide más que una ventana de 720 px: como tiene
  `max-height: min(86vh, 720px); overflow: auto`, se queda con el scroll abajo y se come la medalla y el
  título. El rodaje lo recoloca a mano. En el juego pasa igual en pantallas bajas.
