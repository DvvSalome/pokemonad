// Combates de equipo (gimnasios y arena): hasta 3 contra 3, por turnos, con la misma fórmula de daño que el
// combate contra salvajes (pokemath.ts). Todo el estado vive en el servidor (tabla `duels`); el cliente solo
// elige el ataque del monstruo activo y reproduce los golpes que devuelve `duelTurn`.
import { WILD_LEVEL, damageOf, effectiveness, fighter, levelOf, movesFor, speciesById, type Tier } from './pokemath.ts';

export interface Unit {
  id: string; sid: string; name: string; model: string; type: string; level: number; hp: number; max: number;
  shiny: boolean; logo?: string | null; symbol?: string | null;
}
export interface Duel {
  kind: 'gym' | 'arena'; ref: string; foeName: string; p: Unit[]; f: Unit[]; pi: number; fi: number; turns: number;
  over: null | 'win' | 'lose';
}
export interface DuelEvent { side: 'foe' | 'player'; name: string; type: string; dmg: number; eff: number; ko: boolean; next?: string }

/** Lo que suma la rareza al nivel de combate: un Epic recién atrapado planta cara a un gimnasio medio. */
const TIER_BONUS: Record<Tier, number> = { Common: 0, Uncommon: 2, Rare: 5, Epic: 8, Legendary: 12 };
/** Un combate de equipo no dura para siempre: pasado este número de turnos, pierde quien reta. */
const MAX_TURNS = 80;

export interface BoxMonLike {
  id: string; speciesId: string; name: string; tier: Tier; model: string; stage: number; shiny: boolean;
  token?: { m0: number; marketCap: number; logo?: string; symbol?: string };
}

/** Nivel de combate de una carta: el de su token (sube con el market cap) con suelo 8, más rareza, etapa y shiny. */
export function battleLevel(m: BoxMonLike): number {
  const base = m.token ? levelOf(m.token.m0, m.token.marketCap) : WILD_LEVEL;
  return Math.max(1, Math.min(100, Math.max(8, base) + TIER_BONUS[m.tier] + (m.stage - 1) * 2 + (m.shiny ? 2 : 0)));
}

export function unitOf(m: BoxMonLike, level = battleLevel(m)): Unit {
  const sp = speciesById(m.speciesId), max = fighter(sp.id, level).maxHp;
  return {
    id: m.id, sid: sp.id, name: m.name, model: m.model, type: sp.type, level, hp: max, max, shiny: m.shiny,
    logo: m.token?.logo ?? null, symbol: m.token?.symbol ?? null,
  };
}

export function unitFromLine(id: string, line: string, name: string, model: string, level: number, extra: Partial<Unit> = {}): Unit {
  const sp = speciesById(line), max = fighter(sp.id, level).maxHp;
  return { id, sid: sp.id, name, model, type: sp.type, level, hp: max, max, shiny: false, ...extra };
}

/** El rival elige casi siempre el ataque que más daño esperado hace contra tu monstruo activo. */
function foeMove(foe: Unit, me: Unit) {
  const moves = movesFor(speciesById(foe.sid));
  const score = (i: number) => moves[i].power * effectiveness(moves[i].type, me.type);
  const best = score(0) >= score(1) ? 0 : 1;
  return moves[Math.random() < 0.75 ? best : 1 - best];
}

/** Un turno: el activo del jugador usa el ataque `i` y el del rival contesta, por orden de velocidad. */
export function duelTurn(d: Duel, i: number): DuelEvent[] {
  if (d.over) throw new Error('that battle is over');
  const p = d.p[d.pi], f = d.f[d.fi];
  const move = movesFor(speciesById(p.sid))[i];
  if (!move) throw new Error('bad move');
  const pS = fighter(p.sid, p.level), fS = fighter(f.sid, f.level);
  const events: DuelEvent[] = [];
  const hit = (by: Unit, to: Unit, m: { name: string; type: string; power: number }, side: 'foe' | 'player') => {
    const r = damageOf(m, by === p ? pS : fS, to === p ? pS : fS, to.type);
    to.hp = Math.max(0, to.hp - r.dmg);
    const ev: DuelEvent = { side, name: m.name, type: m.type, ...r, ko: to.hp <= 0 };
    events.push(ev);
    return ev;
  };
  const playerAct = () => hit(p, f, move, 'foe');
  const foeAct = () => hit(f, p, foeMove(f, p), 'player');
  if (pS.spd >= fS.spd) { if (!playerAct().ko) foeAct(); }
  else if (!foeAct().ko) playerAct();

  // Los caídos dejan paso al siguiente del equipo; si no queda nadie, se acaba.
  if (f.hp <= 0) {
    const next = d.f.findIndex((u, k) => k > d.fi && u.hp > 0);
    if (next < 0) d.over = 'win'; else { d.fi = next; events[events.length - 1].next = d.f[next].name; }
  }
  if (!d.over && p.hp <= 0) {
    const next = d.p.findIndex((u, k) => k > d.pi && u.hp > 0);
    if (next < 0) d.over = 'lose'; else { d.pi = next; events[events.length - 1].next = d.p[next].name; }
  }
  d.turns++;
  if (!d.over && d.turns >= MAX_TURNS) d.over = 'lose';
  return events;
}

/** Lo que ve el cliente: los dos equipos con su vida, quién está en pista y sus ataques. */
export function duelView(d: Duel) {
  const moves = movesFor(speciesById(d.p[d.pi].sid)).map((m) => ({ ...m, eff: effectiveness(m.type, d.f[d.fi].type) }));
  return { kind: d.kind, ref: d.ref, foeName: d.foeName, p: d.p, f: d.f, pi: d.pi, fi: d.fi, turns: d.turns, over: d.over, moves };
}
