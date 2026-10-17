// El elenco jugable: los cuatro del Animated Monster Pack de Quaternius (CC0) — goblin, dragón,
// esqueleto y blob. Todos traen su propio esqueleto animado con Idle / Walk / Run dentro del GLB, que es
// lo que el avatar necesita (ver EMBEDDED_NAME_MAP en shared.ts); no hacen falta animaciones externas.
//
// El dragón y el blob salen del pack de monstruos con el color base muy oscuro (ver
// scripts/brighten-model.mjs): las copias de /characters son las aclaradas, que es lo que necesita un
// personaje que ocupa el centro de la pantalla.
//
// `escala` es un multiplicador sobre el tamaño nativo del modelo, y los cuatro vienen de tamaños muy
// distintos (el goblin nativo mide 2.98 unidades y el esqueleto 1.5), así que está calculado para que
// los cuatro midan algo menos de dos metros y se lean a la misma escala contra el mundo. El dragón es la
// excepción a propósito: su modelo tiene el origen 1.6 por debajo porque está modelado volando, así que
// en el juego flota sobre el suelo en vez de caminar.
import type { Avatar3DConfig } from './shared';

export interface RosterEntry extends Avatar3DConfig {
  emoji: string;
  blurb: string;
}

export const CHARACTER_ROSTER: RosterEntry[] = [
  { id: 'goblin', nombre: 'Goblin', modelo_url: '/characters/goblin.glb', escala: 0.62, emoji: '👺', blurb: 'Rápido y con malas ideas' },
  { id: 'skeleton', nombre: 'Esqueleto', modelo_url: '/characters/skeleton.glb', escala: 1.25, emoji: '💀', blurb: 'Lleva siglos recorriendo la región' },
  { id: 'dragon', nombre: 'Dragón', modelo_url: '/characters/dragon.glb', escala: 0.9, emoji: '🐉', blurb: 'No camina: flota' },
  { id: 'blob', nombre: 'Blob', modelo_url: '/characters/blob.glb', escala: 0.95, emoji: '🟢', blurb: 'Rebota más de lo que anda' },
];

export const characterById = (id: string): RosterEntry => CHARACTER_ROSTER.find((c) => c.id === id) ?? CHARACTER_ROSTER[0];
