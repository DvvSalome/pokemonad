// El guion del teaser: que plano entra, cuanto dura y que se lee encima.
//
// Este archivo manda sobre todo lo demas. build.mjs monta el corte con estas duraciones y escribe
// out/timeline.json con el instante exacto en el que empieza cada plano; render-overlay.mjs lee ese
// json y dibuja los rotulos, asi que imagen y texto no pueden descuadrarse.

/** Fundido encadenado entre planos, en segundos. */
export const XFADE = 0.45;
export const FPS = 30;
export const W = 1280, H = 720;

/**
 * `in` es el segundo del plano grabado por el que se entra (los primeros fotogramas suelen traer el
 * movimiento de camara todavia colocandose). `push` mete un zoom lentisimo en los planos de interfaz,
 * que por si solos no tienen movimiento.
 *
 * Los rotulos: `a` la linea grande, `b` la pequena que entra despues, `at` el segundo del plano en el
 * que aparece, `pos` la banda de la pantalla donde cabe sin taparle nada al juego.
 */
export const CLIPS = [
  {
    shot: '01-meadow-orbit', in: 0.6, dur: 5.5,
    caps: [{ a: 'Parece un juego de monstruos.', b: 'Lo es. Durante diez minutos.', at: 0.9, dur: 4.2, pos: 'low' }],
  },
  {
    shot: '02-walk', in: 0.8, dur: 4.5,
    caps: [{ a: 'Diez biomas. Nueve coliseos.', at: 0.5, dur: 3.6, pos: 'high' }],
  },
  {
    // Sin rotulo: el mapa ya dice lo que hay, y encima no cabe nada sin taparlo.
    shot: '03-region', in: 1.0, dur: 3.5, push: true, caps: [],
  },
  {
    shot: '04-coliseum', in: 1.2, dur: 4.5,
    caps: [{ a: 'Y una puerta que pide una firma.', b: 'chainId 10143 · el gas no se nota.', at: 0.6, dur: 3.6, pos: 'low' }],
  },
  {
    shot: '05-mart', in: 0.8, dur: 3.5, push: true,
    caps: [{ a: 'Las bolas se compran con monedas.', at: 0.4, dur: 2.9, pos: 'low' }],
  },
  {
    shot: '06-professor', in: 1.6, dur: 4.5,
    caps: [{ a: 'En la hierba no hay bichos.', b: 'Hay profesores.', at: 0.5, dur: 3.8, pos: 'low' }],
  },
  {
    shot: '07-catch-aim', in: 0.9, dur: 3.5,
    caps: [{ a: 'Primero hay que convencerlos.', at: 0.4, dur: 2.9, pos: 'high' }],
  },
  {
    shot: '08-catch-seal', in: 1.0, dur: 3.0,
    caps: [{ a: 'Y solo entonces dan clase.', at: 0.3, dur: 2.5, pos: 'low' }],
  },
  {
    // La clase se lee en el propio juego: cualquier rotulo encima sobra y tapa.
    shot: '09-lecture', in: 1.4, dur: 6.5, caps: [],
  },
  {
    shot: '10-gate', in: 0.9, dur: 4.5, push: true,
    // Sin rotulo: el panel del guardian ocupa la pantalla entera y ya dice la red y lo que cuesta.
    caps: [],
  },
  {
    shot: '11-roster', in: 0.9, dur: 3.5, push: true,
    caps: [{ a: 'Tres jefes. Un temario.', at: 0.4, dur: 2.8, pos: 'high' }],
  },
  {
    shot: '12-battle-intro', in: 2.6, dur: 4.5,
    caps: [{ a: 'Cada turno es una pregunta.', at: 0.5, dur: 3.5, pos: 'high' }],
  },
  {
    shot: '13-battle-wrong', in: 3.0, dur: 5.5,
    caps: [{ a: 'Fallas y te explican por qué.', b: 'Perder vida es aprender algo.', at: 0.5, dur: 4.5, pos: 'high' }],
  },
  {
    shot: '14-battle-win', in: 0.35, dur: 3.0,
    caps: [{ a: 'Aciertas y pegas.', at: 0.3, dur: 2.4, pos: 'high' }],
  },
  {
    shot: '15-badge', in: 1.2, dur: 5.0, push: true,
    caps: [{ a: 'La insignia es soulbound.', b: 'Un certificado que se vende no certifica nada.', at: 0.5, dur: 4.2, pos: 'high' }],
  },
  {
    shot: null, dur: 5.0, // negro: encima va la marca
    caps: [{ wordmark: 'pokemonad', b: 'Monad testnet · chainId 10143', at: 0.5, dur: 4.2 }],
  },
];
