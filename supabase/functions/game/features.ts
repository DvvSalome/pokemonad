// Lo que tenía el original y nos faltaba: equipo, 8 gimnasios con medallas (sus líderes son los tokens más grandes
// de Arc), arena por rating contra los equipos de otros entrenadores, mercado de cartas pagado wallet a wallet,
// legendarios con horario en Legend Summit (gratis para holders), premios de captura de la semana / dorado /
// legendario / hitos del Dex, ventajas extra por holdear y la lista de tokens descubiertos.
// Se monta desde index.ts con `makeFeatures(ctx)`: aquí no hay estado propio, todo pasa por la base.
import { formatUnits, parseUnits } from 'npm:viem@2';
import { BALL_KEYS, CATALOG, hash32, modelOf, speciesById, speciesName, stageOf, type BallKey, type Tier } from './pokemath.ts';
import { battleLevel, duelTurn, duelView, unitFromLine, unitOf, type BoxMonLike, type Duel } from './duel.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface FTrainer {
  id: string; name: string; wallet: string | null; balls: Record<BallKey, number>; buffs: Record<string, number>;
  daily: Record<string, Any>; stats: Record<string, number>; team?: string[]; badges?: number[]; elo?: number;
  hold_bal: string | null;
}
export interface Ctx {
  db: Any;
  fail: (msg: string, status?: number) => Error;
  pay: { chainId: number; chainName: string; explorer: string; token: string; decimals: number; symbol: string };
  envOr: (k: string, d: string) => string;
  verifyTransfer: (hash: string, o: { from: string; to: string; min: bigint; none: string }) => Promise<{ paid: bigint; block: bigint }>;
  boxOf: (id: string) => Promise<(BoxMonLike & { discovered: boolean; token?: Any })[]>;
  saveTrainer: (t: Any, patch: Any) => Promise<void>;
  weekAdd: (t: Any, pts: number, wins?: number, disc?: number) => Promise<void>;
  withPoints: (t: Any, pts: number) => Any;
  publicTrainer: (t: Any) => Any;
  holdTier: (t: Any) => string | null;
  balanceOf: (a: string) => Promise<bigint>;
  prizeMinHold: string;
  weekOf: (ms: number) => number;
  today: () => string;
  buffOn: (t: Any, k: string) => boolean;
  fresh: () => Promise<Any[]>;
  progressWin: (t: Any) => Any;
  mainnet: boolean;
}

const jsonOr = <T,>(raw: string | undefined, d: T): T => { try { return raw ? { ...d, ...JSON.parse(raw) } : d; } catch { return d; } };
const isAddr = (a: string) => /^0x[0-9a-f]{40}$/.test(a);
const addBalls = (b: Record<BallKey, number>, add: Partial<Record<BallKey, number>>) => {
  const out = { ...b };
  for (const k of BALL_KEYS) out[k] = (out[k] ?? 0) + (add[k] ?? 0);
  return out;
};

export function makeFeatures(c: Ctx) {
  const { db, fail, pay } = c;
  const env = (k: string) => Deno.env.get(k)?.trim() || undefined;

  // ---------- ventajas extra por holdear (además de las bolas diarias y el shiny de index.ts) ----------
  /** league: bonus de puntos de liga; radar: Rare Radar siempre activo; summit: legendarios del horario gratis. */
  const HOLD_PERKS = jsonOr<Record<string, { league: number; radar: boolean }>>(env('HOLD_PERKS'), {
    Ace: { league: 0.05, radar: false }, Veteran: { league: 0.1, radar: true }, Champion: { league: 0.2, radar: true },
  });
  /** Evento de temporada (como la Ghost Week del original): multiplica los puntos de captura entre `from` y `to`. */
  const SEASON = (() => {
    const raw = env('SEASON_EVENT');
    if (raw === 'off') return null;
    const s = jsonOr(raw, { name: 'Ghost Week', from: '2026-10-24', to: '2026-11-03', mult: 2 });
    const from = Date.parse(`${s.from}T00:00:00Z`), to = Date.parse(`${s.to}T00:00:00Z`);
    return Number.isFinite(from) && Number.isFinite(to) && s.mult > 0 ? { name: String(s.name), from, to, mult: Number(s.mult) } : null;
  })();
  const seasonNow = () => (SEASON && Date.now() >= SEASON.from && Date.now() < SEASON.to ? SEASON : null);

  /** Puntos de liga con el bonus del nivel de holder (y ×temporada si es una captura). */
  function boostPts(t: FTrainer, pts: number, isCatch = false) {
    const tier = c.holdTier(t);
    const k = (1 + (tier ? HOLD_PERKS[tier]?.league ?? 0 : 0)) * (isCatch ? seasonNow()?.mult ?? 1 : 1);
    return Math.round(pts * k);
  }
  /** Buffs que ve el cliente: el Radar permanente de los holders Veteran/Champion. */
  function buffsView(t: FTrainer) {
    const tier = c.holdTier(t);
    if (!tier || !HOLD_PERKS[tier]?.radar) return t.buffs;
    return { ...t.buffs, radar: Math.max(t.buffs?.radar ?? 0, Date.now() + 6 * 3600_000) };
  }
  const perksText = () => Object.fromEntries(Object.entries(HOLD_PERKS).map(([k, v]) => [k, v]));

  // ---------- premios instantáneos (dorado, legendario, hitos del Dex) ----------
  const BOUNTY = jsonOr<{ golden: string; legendary: string; dex: Record<string, string> }>(env('PRIZE_BOUNTIES'), c.mainnet
    ? { golden: '200000', legendary: '100000', dex: { 10: '50000', 20: '100000', 30: '200000', 39: '500000' } }
    : { golden: '0.1', legendary: '0.05', dex: { 10: '0.02', 20: '0.05', 30: '0.1', 39: '0.25' } });
  /** Bolas que da cada hito del Dex (siempre, con o sin wallet). */
  const DEX_BALLS: Record<string, Partial<Record<BallKey, number>>> = {
    10: { super: 5 }, 20: { hyper: 3 }, 30: { hyper: 5, hood: 1 }, 39: { hood: 3 },
  };

  /** Anota un premio a cobrar si la wallet cumple el mínimo. `ref` hace que el mismo premio no se dé dos veces. */
  async function awardPrize(t: FTrainer, category: string, ref: string, amount: string | undefined, score = 0) {
    if (!amount || !(Number(amount) > 0)) return null;
    if (!t.wallet) return { ok: false, why: 'wallet' };
    const bal = await c.balanceOf(t.wallet).catch(() => null);
    if (bal === null || bal < parseUnits(c.prizeMinHold, pay.decimals)) return { ok: false, why: 'hold' };
    const wk = c.weekOf(Date.now());
    for (let i = 0; i < 4; i++) {
      const { data: top } = await db.from('prizes').select('rank').eq('week_id', wk).eq('category', category)
        .order('rank', { ascending: false }).limit(1).maybeSingle();
      const { error } = await db.from('prizes').insert({
        week_id: wk, category, rank: (top?.rank ?? 0) + 1, trainer_id: t.id, name: t.name, wallet: t.wallet, score,
        amount, token: pay.token, chain_id: pay.chainId, ref,
      });
      if (!error) return { ok: true, amount, symbol: pay.symbol };
      if (/prizes_ref_key/.test(error.message)) return null;
      if (!/duplicate/i.test(error.message)) throw fail(error.message, 500);
    }
    return null;
  }
  const prizeNote = (r: Any, what: string) => !r ? null : r.ok
    ? `${what}: ${r.amount} ${r.symbol} prize (paid by the team)`
    : `${what}: link a wallet holding ≥ ${c.prizeMinHold} ${pay.symbol} to win the ${pay.symbol} prize`;

  /** Hitos del Dex: especies distintas en la Caja. Da bolas (siempre) y el premio en token (con wallet). */
  async function dexCheck(t: FTrainer): Promise<{ patch: Any; notes: string[] }> {
    const { data } = await db.from('box').select('species_id').eq('trainer_id', t.id);
    const n = new Set((data ?? []).map((r: Any) => r.species_id)).size;
    const done = t.stats?.dexm ?? 0;
    const hits = Object.keys(DEX_BALLS).map(Number).filter((m) => m <= n && m > done).sort((a, b) => a - b);
    if (!hits.length) return { patch: null, notes: [] };
    let balls = t.balls;
    const notes: string[] = [];
    for (const m of hits) {
      balls = addBalls(balls, DEX_BALLS[m]);
      const r = await awardPrize(t, 'dex', `dex:${m}:${t.id}`, BOUNTY.dex[m], n);
      notes.push(prizeNote(r, `Dex milestone ${m}`) ?? `Dex milestone ${m}!`);
    }
    return { patch: { balls, stats: { ...t.stats, dexm: hits[hits.length - 1] } }, notes };
  }

  // ---------- legendarios con horario en Legend Summit ----------
  const LEG_EVERY = 2 * 3600_000, LEG_DUR = 30 * 60_000;
  const LEG_POOL = CATALOG.filter((s) => s.tier === 'Epic');
  /** Uno cada 2 h, 30 min, a una hora distinta en cada franja (igual para todos: sale de un hash de la franja). */
  function legendOf(slot: number) {
    const h = hash32(`legend-${slot}`);
    const start = slot * LEG_EVERY + (h % (LEG_EVERY - LEG_DUR));
    const line = LEG_POOL[(h >>> 7) % LEG_POOL.length].id;
    return { id: `legend-${slot}`, slot, line, name: speciesName(line, 3), start, end: start + LEG_DUR };
  }
  function legendNow(now = Date.now()) {
    const L = legendOf(Math.floor(now / LEG_EVERY));
    return now >= L.start && now < L.end ? L : null;
  }
  /** Entra gratis cualquier holder; sin nivel, hace falta el Summit Pass activo. */
  const legendAccess = (t: FTrainer) => !!c.holdTier(t) || c.buffOn(t, 'summit');
  /** El legendario del horario como salvaje privado en la cumbre (el cliente ya sabe dibujar los `summit`). */
  function legendExtra(t: FTrainer) {
    const L = legendNow();
    if (!L || !legendAccess(t) || t.daily?.legend === L.id) return [];
    return [{ id: L.id, line: L.line, expiresAt: L.end, kind: 'summit' }];
  }
  function legendCheck(t: FTrainer, spawnId: string) {
    const L = legendNow();
    if (!L || L.id !== spawnId) throw fail('the legendary has left the summit');
    if (!legendAccess(t)) throw fail('Legend Summit is for holders or with a Summit Pass', 403);
    if (t.daily?.legend === L.id) throw fail('already caught');
    return L;
  }
  async function legendsView(t: FTrainer) {
    const now = Date.now(), slot = Math.floor(now / LEG_EVERY);
    const list = [];
    for (let s = slot; list.length < 12; s++) { const L = legendOf(s); if (L.end > now) list.push({ ...L, name: speciesName(L.line, 3) }); }
    const { data: fame } = await db.from('prizes').select('name, week_id, created_at, status, tx_hash').eq('category', 'legendary')
      .order('created_at', { ascending: false }).limit(10);
    return {
      now, access: legendAccess(t), holder: !!c.holdTier(t), schedule: list.map((L) => ({ id: L.id, line: L.line, name: L.name, start: L.start, end: L.end })),
      caughtThis: t.daily?.legend ?? null, hallOfFame: (fame ?? []).map((f: Any) => ({ name: f.name, at: Date.parse(f.created_at), paid: f.status === 'paid', tx: f.tx_hash })),
      bounty: BOUNTY.legendary, symbol: pay.symbol,
    };
  }

  /** Tras cada captura: mejor captura de la semana, dorado/legendario con premio, y los hitos del Dex. */
  async function afterCatch(t: FTrainer, o: { spawnId: string; token: string | null; mcap: number; name: string; golden: boolean }) {
    const notes: string[] = [];
    let patch: Any = {};
    if (o.token && o.mcap > 0) await db.rpc('week_best', { tid: t.id, wk: c.weekOf(Date.now()), mc: o.mcap, nm: o.name.slice(0, 32) });
    if (o.golden) { const n = prizeNote(await awardPrize(t, 'golden', `gold:${o.spawnId}`, BOUNTY.golden), 'Golden Monster'); if (n) notes.push(n); }
    if (o.spawnId.startsWith('legend-')) {
      patch.daily = { ...(t.daily ?? {}), legend: o.spawnId };
      const n = prizeNote(await awardPrize(t, 'legendary', `legend:${o.spawnId}`, BOUNTY.legendary), 'First to catch this legendary');
      if (n) notes.push(n);
    }
    const dex = await dexCheck({ ...t, ...patch });
    if (dex.patch) patch = { ...patch, ...dex.patch };
    notes.push(...dex.notes);
    return { patch, notes };
  }

  // ---------- equipo ----------
  async function listedIds(trainerId: string): Promise<Set<string>> {
    const { data } = await db.from('market').select('spawn_id').eq('seller_id', trainerId).eq('status', 'open');
    return new Set((data ?? []).map((r: Any) => r.spawn_id));
  }
  const fightable = (t: FTrainer, m: Any) => {
    const tk = m.token;
    const fainted = tk && tk.m0 > 0 && tk.marketCap > 0 && tk.marketCap < 0.35 * tk.m0;
    return !fainted || c.buffOn(t, 'revive');
  };
  /** Los elegidos (si siguen en la Caja y pueden pelear) y, si faltan, los de más nivel. */
  async function teamOf(t: FTrainer, box?: Any[]) {
    const all = box ?? await c.boxOf(t.id);
    const listed = await listedIds(t.id);
    const ok = all.filter((m) => !listed.has(m.id) && fightable(t, m));
    const picked = (t.team ?? []).map((id) => ok.find((m) => m.id === id)).filter(Boolean) as Any[];
    const rest = ok.filter((m) => !picked.includes(m)).sort((a, b) => battleLevel(b) - battleLevel(a));
    return [...picked, ...rest].slice(0, 3);
  }
  async function teamSet(t: FTrainer, ids: unknown) {
    const list = Array.isArray(ids) ? [...new Set(ids.map(String))].slice(0, 3) : [];
    const box = await c.boxOf(t.id);
    const listed = await listedIds(t.id);
    for (const id of list) {
      if (!box.some((m) => m.id === id)) throw fail('that monster is not in your box');
      if (listed.has(id)) throw fail('that card is on the market');
    }
    await c.saveTrainer(t, { team: list });
    return { team: list, fighters: (await teamOf(t, box)).map((m) => ({ id: m.id, level: battleLevel(m) })) };
  }

  // ---------- gimnasios ----------
  const GYM_LEVELS: number[] = (() => { try { const v = JSON.parse(env('GYM_LEVELS') ?? ''); if (Array.isArray(v) && v.length === 8) return v.map(Number); } catch { /* por defecto */ } return [7, 9, 11, 13, 15, 17, 19, 21]; })();
  const gymReward = (i: number) => ({ balls: { super: 3 + i, hyper: 1 + Math.floor(i / 2), hood: i === 7 ? 1 : 0 } as Partial<Record<BallKey, number>>, points: 100 + 40 * i });
  const REMATCH = { balls: { ball: 5 } as Partial<Record<BallKey, number>>, points: 20 };

  /** Los 8 líderes: los tokens más grandes que hay ahora en Arc (el 1.º gimnasio, el menor de los 8). */
  async function gymLeaders() {
    const top = (await c.fresh()).slice().sort((a: Any, b: Any) => b.mcap - a.mcap).slice(0, 8).reverse();
    return Array.from({ length: 8 }, (_, i) => {
      const tok = top[i];
      const lead = tok?.line ?? LEG_POOL[i % LEG_POOL.length].id;
      const type = speciesById(lead).type;
      const sameType = CATALOG.filter((s) => s.type === type && s.id !== lead);
      const pool = sameType.length >= 2 ? sameType : CATALOG.filter((s) => s.id !== lead);
      const h = hash32(`gym-${i}-${tok?.address ?? lead}`);
      const lines = [pool[h % pool.length].id, pool[(h >>> 9) % pool.length].id, lead];
      const lv = GYM_LEVELS[i];
      const stage = tok ? stageOf(tok.mcap) : 3;
      const team = lines.map((line, k) => {
        const st = k === 2 ? stage : Math.max(1, stage - 1);
        const nm = k === 2 && tok ? String(tok.symbol) : speciesName(line, st);
        return { line, name: nm, model: modelOf(line, st), level: lv + (k === 2 ? 2 : k) };
      });
      return {
        i, n: i + 1, leader: tok ? `$${tok.symbol}` : `Leader ${i + 1}`, symbol: tok?.symbol ?? null, logo: tok?.logo ?? null,
        address: tok?.address ?? null, mcap: tok?.mcap ?? null, type, team,
      };
    });
  }
  async function gymsView(t: FTrainer) {
    const badges = t.badges ?? [];
    const gyms = (await gymLeaders()).map((g) => ({
      ...g, beaten: badges.includes(g.n), locked: g.n > 1 && !badges.includes(g.n - 1),
      reward: gymReward(g.i), rematchToday: t.daily?.[`gym${g.n}`] === c.today(),
    }));
    return { gyms, badges, rematch: REMATCH, team: (await teamOf(t)).map((m) => ({ ...unitOf(m), stage: m.stage, tier: m.tier })) };
  }

  // ---------- combate de equipo (común a gimnasio y arena) ----------
  async function saveDuel(t: FTrainer, d: Duel) {
    const { error } = await db.from('duels').upsert({ trainer_id: t.id, kind: d.kind, ref: d.ref, state: d, started_at: new Date().toISOString() });
    if (error) throw fail(error.message, 500);
  }
  async function getDuel(t: FTrainer): Promise<Duel> {
    const { data } = await db.from('duels').select('state').eq('trainer_id', t.id).maybeSingle();
    if (!data) throw fail('no battle');
    return data.state as Duel;
  }
  async function myUnits(t: FTrainer) {
    const team = await teamOf(t);
    if (!team.length) throw fail('your box has no monster that can fight');
    return team.map((m) => unitOf(m));
  }

  async function gymStart(t: FTrainer, n: number) {
    const badges = t.badges ?? [];
    if (!Number.isInteger(n) || n < 1 || n > 8) throw fail('no such gym');
    if (n > 1 && !badges.includes(n - 1)) throw fail(`beat gym ${n - 1} first`);
    const g = (await gymLeaders())[n - 1];
    const f = g.team.map((u, k) => unitFromLine(`gym${n}-${k}`, u.line, u.name, u.model, u.level, k === 2 ? { logo: g.logo, symbol: g.symbol } : {}));
    const d: Duel = { kind: 'gym', ref: String(n), foeName: g.leader, p: await myUnits(t), f, pi: 0, fi: 0, turns: 0, over: null };
    await saveDuel(t, d);
    return duelView(d);
  }

  // ---------- arena ----------
  const ARENA_DAILY = Number(c.envOr('ARENA_DAILY', '15'));
  const ARENA_K = 32;
  async function arenaView(t: FTrainer) {
    const elo = t.elo ?? 1000;
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const pickFrom = async (lo: number, hi: number) => (await db.from('trainers').select('id, name, elo, badges, wallet')
      .neq('id', t.id).gte('elo', lo).lte('elo', hi).gte('seen_at', since).gt('score', 0).order('seen_at', { ascending: false }).limit(40)).data ?? [];
    let pool: Any[] = await pickFrom(elo - 200, elo + 200);
    if (pool.length < 4) pool = await pickFrom(0, 100000);
    const seed = `${t.id}|${c.today()}|${t.daily?.arenaN ?? 0}`;
    const opponents = pool.map((p) => ({ p, k: hash32(`${seed}|${p.id}`) })).sort((a, b) => a.k - b.k).slice(0, 4).map(({ p }) => ({
      id: p.id, name: p.name, elo: p.elo, badges: (p.badges ?? []).length, wallet: !!p.wallet,
      beatenToday: (t.daily?.arenaBeat ?? []).includes(p.id),
    }));
    const [{ data: top }, { count }] = await Promise.all([
      db.from('trainers').select('name, elo, wallet').gte('seen_at', since).order('elo', { ascending: false }).limit(10),
      db.from('trainers').select('id', { count: 'exact', head: true }).gt('elo', elo).gte('seen_at', since),
    ]);
    const left = t.daily?.arenaD === c.today() ? Math.max(0, ARENA_DAILY - (t.daily.arenaN ?? 0)) : ARENA_DAILY;
    return { elo, rank: (count ?? 0) + 1, left, daily: ARENA_DAILY, opponents, top: (top ?? []).map((r: Any, i: number) => ({ rank: i + 1, name: r.name, elo: r.elo, wallet: !!r.wallet })) };
  }
  async function arenaStart(t: FTrainer, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id) || id === t.id) throw fail('pick another trainer');
    const day = c.today();
    const n = t.daily?.arenaD === day ? t.daily.arenaN ?? 0 : 0;
    if (n >= ARENA_DAILY) throw fail(`that is all the arena battles for today (${ARENA_DAILY})`, 429);
    const { data: foe } = await db.from('trainers').select('*').eq('id', id).maybeSingle();
    if (!foe) throw fail('no such trainer', 404);
    const foeTeam = await teamOf({ ...foe, buffs: { revive: Date.now() + 60_000 } } as FTrainer);
    if (!foeTeam.length) throw fail('that trainer has no team yet');
    const d: Duel = {
      kind: 'arena', ref: id, foeName: foe.name, p: await myUnits(t),
      f: foeTeam.map((m) => unitOf(m)), pi: 0, fi: 0, turns: 0, over: null,
    };
    await c.saveTrainer(t, { daily: { ...(t.daily ?? {}), arenaD: day, arenaN: n + 1, ...(t.daily?.arenaD === day ? {} : { arenaBeat: [] }) } });
    await saveDuel(t, d);
    return duelView(d);
  }

  /** Premios al terminar: medalla y bolas (gimnasio), rating y victoria semanal (arena). */
  async function duelFinish(t: FTrainer, d: Duel) {
    await db.from('duels').delete().eq('trainer_id', t.id);
    const out: Any = { result: d.over };
    if (d.kind === 'gym') {
      if (d.over !== 'win') return out;
      const n = Number(d.ref), badges = t.badges ?? [];
      const first = !badges.includes(n);
      if (!first && t.daily?.[`gym${n}`] === c.today()) return { ...out, reward: null, note: 'rematch reward already collected today' };
      const r = first ? gymReward(n - 1) : REMATCH;
      const pts = boostPts(t, r.points);
      await c.saveTrainer(t, {
        ...c.withPoints(t, pts), balls: addBalls(t.balls, r.balls), missions: c.progressWin(t),
        badges: first ? [...badges, n].sort((a, b) => a - b) : badges, daily: { ...(t.daily ?? {}), [`gym${n}`]: c.today() },
      });
      await c.weekAdd(t, pts);
      return { ...out, badge: first ? n : null, reward: r.balls, points: pts };
    }
    // Arena: el rating cambia siempre; la victoria semanal (premio de arena) solo una vez por rival y día.
    const { data: foe } = await db.from('trainers').select('id, elo').eq('id', d.ref).maybeSingle();
    const me = t.elo ?? 1000, fo = foe?.elo ?? 1000;
    const exp = 1 / (1 + Math.pow(10, (fo - me) / 400));
    const beat: string[] = t.daily?.arenaBeat ?? [];
    const repeat = beat.includes(d.ref);
    const delta = repeat ? 0 : Math.round(ARENA_K * ((d.over === 'win' ? 1 : 0) - exp));
    const patch: Any = { elo: Math.max(100, me + delta) };
    if (d.over === 'win') {
      const pts = repeat ? 0 : boostPts(t, 30);
      Object.assign(patch, c.withPoints(t, pts), { missions: c.progressWin(t), daily: { ...(t.daily ?? {}), arenaBeat: [...beat, d.ref].slice(-40) } });
      await c.saveTrainer(t, patch);
      if (!repeat) await c.weekAdd(t, pts, 1);
      out.points = pts;
    } else await c.saveTrainer(t, patch);
    if (foe && delta) await db.from('trainers').update({ elo: Math.max(100, fo - delta) }).eq('id', foe.id);
    return { ...out, elo: patch.elo, delta, counted: !repeat && d.over === 'win' };
  }

  async function duelMove(t: FTrainer, i: number) {
    const d = await getDuel(t);
    let events;
    try { events = duelTurn(d, i); } catch (e) { throw fail((e as Error).message); }
    const view = duelView(d);
    if (!d.over) { await saveDuel(t, d); return { events, duel: view }; }
    return { events, duel: view, end: await duelFinish(t, d), trainer: c.publicTrainer(t) };
  }
  async function duelLeave(t: FTrainer) {
    const { data } = await db.from('duels').select('state').eq('trainer_id', t.id).maybeSingle();
    if (!data) return { ok: true };
    const d = data.state as Duel;
    d.over = 'lose';
    // Rendirse en la arena cuenta como derrota (si no, se huiría de todo combate perdido).
    const end = d.kind === 'arena' ? await duelFinish(t, d) : (await db.from('duels').delete().eq('trainer_id', t.id), { result: 'lose' });
    return { ok: true, end, trainer: c.publicTrainer(t) };
  }
  async function duelGet(t: FTrainer) {
    const { data } = await db.from('duels').select('state').eq('trainer_id', t.id).maybeSingle();
    return { duel: data ? duelView(data.state as Duel) : null };
  }

  // ---------- mercado de cartas ----------
  const MARKET_MIN = c.envOr('MARKET_MIN_PRICE', c.mainnet ? '1000' : '0.01');
  const MARKET_MAX = c.envOr('MARKET_MAX_PRICE', c.mainnet ? '100000000' : '1000');
  const MARKET_MAX_OPEN = 10;
  const RESERVE_MS = 15 * 60_000;
  const listingView = (l: Any, me: string) => ({
    id: l.id, spawnId: l.spawn_id, name: l.name, tier: l.tier, shiny: l.shiny, stage: l.stage, model: l.model, speciesId: l.species_id,
    token: l.token, symbol: l.symbol, logo: l.logo, price: l.price, payToken: l.pay_token, status: l.status,
    seller: l.seller_name ?? null, mine: l.seller_id === me, sellerWallet: l.seller_wallet,
    reserved: !!(l.reserved_until && Date.parse(l.reserved_until) > Date.now() && l.reserved_by !== me),
    reservedByMe: l.reserved_by === me && l.reserved_until && Date.parse(l.reserved_until) > Date.now(),
    at: Date.parse(l.created_at), soldAt: l.sold_at ? Date.parse(l.sold_at) : null, tx: l.tx_hash,
  });
  async function marketView(t: FTrainer) {
    const [{ data: open }, { data: mine }, { data: sold }] = await Promise.all([
      db.from('market').select('*, trainers!market_seller_id_fkey(name)').eq('status', 'open').eq('pay_token', pay.token).eq('chain_id', pay.chainId)
        .order('created_at', { ascending: false }).limit(60),
      db.from('market').select('*').eq('seller_id', t.id).order('created_at', { ascending: false }).limit(20),
      db.from('market').select('*, trainers!market_seller_id_fkey(name)').eq('status', 'sold').order('sold_at', { ascending: false }).limit(10),
    ]);
    const nm = (l: Any) => ({ ...l, seller_name: l.trainers?.name });
    return {
      listings: (open ?? []).map((l: Any) => listingView(nm(l), t.id)), mine: (mine ?? []).map((l: Any) => listingView(l, t.id)),
      sold: (sold ?? []).map((l: Any) => listingView(nm(l), t.id)),
      symbol: pay.symbol, token: pay.token, decimals: pay.decimals, chainId: pay.chainId, chainName: pay.chainName, explorer: pay.explorer,
      min: MARKET_MIN, max: MARKET_MAX, wallet: t.wallet,
    };
  }
  async function marketList(t: FTrainer, spawnId: string, price: string) {
    if (!t.wallet) throw fail('connect your wallet first', 403);
    const p = String(price ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(p)) throw fail('bad price');
    let amt: bigint;
    try { amt = parseUnits(p, pay.decimals); } catch { throw fail('bad price'); }
    if (amt < parseUnits(MARKET_MIN, pay.decimals) || amt > parseUnits(MARKET_MAX, pay.decimals)) throw fail(`price must be between ${MARKET_MIN} and ${MARKET_MAX} ${pay.symbol}`);
    const { data: b } = await db.from('box').select('*, tokens(symbol, logo)').eq('trainer_id', t.id).eq('spawn_id', spawnId).maybeSingle();
    if (!b) throw fail('that monster is not in your box');
    const { count } = await db.from('market').select('id', { count: 'exact', head: true }).eq('seller_id', t.id).eq('status', 'open');
    if ((count ?? 0) >= MARKET_MAX_OPEN) throw fail(`you already have ${MARKET_MAX_OPEN} cards on the market`);
    const { data: row, error } = await db.from('market').insert({
      seller_id: t.id, seller_wallet: t.wallet, box_id: b.id, spawn_id: b.spawn_id, name: b.name, tier: b.tier, shiny: b.shiny,
      stage: b.stage, model: b.model, species_id: b.species_id, token: b.token, symbol: b.tokens?.symbol ?? null, logo: b.tokens?.logo ?? null,
      price: formatUnits(amt, pay.decimals), pay_token: pay.token, chain_id: pay.chainId,
    }).select('*').single();
    if (error) throw fail(/duplicate/i.test(error.message) ? 'that card is already on the market' : error.message, 409);
    // Mientras está a la venta no se puede intercambiar ni llevar en el equipo.
    await Promise.all([
      db.from('trades').update({ status: 'cancelled' }).eq('status', 'pending').eq('from_id', t.id).eq('give', b.spawn_id),
      db.from('trades').update({ status: 'cancelled' }).eq('status', 'pending').eq('to_id', t.id).eq('want', b.spawn_id),
    ]);
    if ((t.team ?? []).includes(b.spawn_id)) await c.saveTrainer(t, { team: (t.team ?? []).filter((x) => x !== b.spawn_id) });
    return { listing: listingView(row, t.id) };
  }
  async function marketUnlist(t: FTrainer, id: string) {
    const { data: l } = await db.from('market').select('*').eq('id', id).eq('seller_id', t.id).eq('status', 'open').maybeSingle();
    if (!l) throw fail('no such listing');
    if (l.reserved_until && Date.parse(l.reserved_until) > Date.now()) throw fail('a buyer is paying for it right now: try again in a few minutes', 409);
    await db.from('market').update({ status: 'cancelled' }).eq('id', id).eq('status', 'open');
    return { ok: true };
  }
  /** El comprador reserva la carta 15 min: así nadie más la paga a la vez. Devuelve a quién y cuánto pagar. */
  async function marketQuote(t: FTrainer, id: string) {
    if (!t.wallet) throw fail('connect your wallet first', 403);
    const { data: l } = await db.from('market').select('*').eq('id', id).eq('status', 'open').maybeSingle();
    if (!l) throw fail('that card is no longer for sale');
    if (l.seller_id === t.id) throw fail('that is your own card');
    if (l.seller_wallet === t.wallet) throw fail('you cannot buy from your own wallet');
    if (l.pay_token !== pay.token || Number(l.chain_id) !== pay.chainId) throw fail('that listing is in another token/network', 409);
    const { data: has } = await db.from('box').select('id').eq('trainer_id', t.id)
      .or(l.token ? `spawn_id.eq.${l.spawn_id},token.eq.${l.token}` : `spawn_id.eq.${l.spawn_id}`).limit(1);
    if (has?.length) throw fail('you already have that monster');
    const until = new Date(Date.now() + RESERVE_MS).toISOString();
    const free = `reserved_until.is.null,reserved_until.lt.${new Date().toISOString()},reserved_by.eq.${t.id}`;
    const { data: ok } = await db.from('market').update({ reserved_by: t.id, reserved_until: until }).eq('id', id).eq('status', 'open').or(free).select('id');
    if (!ok?.length) throw fail('another trainer is buying it right now', 409);
    return { id, to: l.seller_wallet, token: pay.token, amount: parseUnits(l.price, pay.decimals).toString(), price: l.price, symbol: pay.symbol, chainId: pay.chainId, until: Date.parse(until) };
  }
  /** Tras pagar: se verifica en la red (del comprador al vendedor, al menos el precio) y se mueve la carta. */
  async function marketBuy(t: FTrainer, id: string, txHash: string) {
    if (!t.wallet) throw fail('connect your wallet first', 403);
    const hash = String(txHash).toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw fail('pay with your wallet first (missing transaction)', 402);
    const { data: l } = await db.from('market').select('*').eq('id', id).maybeSingle();
    if (!l) throw fail('no such listing', 404);
    if (l.status === 'sold') throw fail(l.buyer_id === t.id ? 'already yours' : 'that card is no longer for sale', 409);
    if (l.reserved_by !== t.id) throw fail('reserve the card before paying', 409);
    const [{ data: u1 }, { data: u2 }, { data: u3 }] = await Promise.all([
      db.from('market').select('id').eq('tx_hash', hash).maybeSingle(),
      db.from('payments').select('tx_hash').eq('tx_hash', hash).maybeSingle(),
      db.from('prizes').select('id').eq('tx_hash', hash).maybeSingle(),
    ]);
    if (u1 || u2 || u3) throw fail('that transaction was already used', 409);
    await c.verifyTransfer(hash, {
      from: t.wallet, to: l.seller_wallet, min: parseUnits(l.price, pay.decimals),
      none: `no ${pay.symbol} transfer from your wallet to the seller in that transaction`,
    });
    const { data: r, error } = await db.rpc('market_settle', { p_id: id, p_buyer: t.id, p_tx: hash });
    if (error) throw fail(/duplicate/i.test(error.message) ? 'that transaction was already used' : error.message, 409);
    if (r !== 'ok') throw fail(String(r), 409);
    return { ok: true, box: await c.boxOf(t.id) };
  }

  // ---------- tokens descubiertos (público) ----------
  async function discovered(offset: number) {
    const from = Math.max(0, Math.min(5000, Math.floor(offset) || 0));
    const { data } = await db.from('tokens').select('address, symbol, name, logo, mcap, stage, dex_no, first_trainer, catches, line')
      .not('dex_no', 'is', null).order('dex_no', { ascending: false }).range(from, from + 39);
    const ids = [...new Set((data ?? []).map((x: Any) => x.first_trainer).filter(Boolean))];
    const { data: names } = ids.length ? await db.from('trainers').select('id, name').in('id', ids) : { data: [] };
    const nm = new Map((names ?? []).map((n: Any) => [n.id, n.name]));
    return {
      tokens: (data ?? []).map((x: Any) => ({
        address: x.address, symbol: x.symbol, name: x.name, logo: x.logo, mcap: x.mcap, stage: x.stage, dexNo: x.dex_no,
        catches: x.catches, line: x.line, by: nm.get(x.first_trainer) ?? null,
      })),
      next: (data ?? []).length === 40 ? from + 40 : null,
    };
  }

  /** Invitado que conecta una wallet que ya tenía entrenador: su Caja pasa a ese entrenador (sin duplicados). */
  async function mergeGuest(guestId: string, ownerId: string) {
    const [{ data: g }, { data: o }] = await Promise.all([
      db.from('box').select('id, spawn_id, token').eq('trainer_id', guestId),
      db.from('box').select('spawn_id, token').eq('trainer_id', ownerId),
    ]);
    const spawns = new Set((o ?? []).map((r: Any) => r.spawn_id)), toks = new Set((o ?? []).map((r: Any) => r.token).filter(Boolean));
    const move = (g ?? []).filter((r: Any) => !spawns.has(r.spawn_id) && !(r.token && toks.has(r.token))).map((r: Any) => r.id);
    if (move.length) await db.from('box').update({ trainer_id: ownerId }).in('id', move);
    await db.from('trades').update({ status: 'cancelled' }).eq('status', 'pending').or(`from_id.eq.${guestId},to_id.eq.${guestId}`);
    return move.length;
  }

  const prizesConfig = () => ({ bounties: BOUNTY, season: SEASON, perks: perksText(), gymLevels: GYM_LEVELS, arenaDaily: ARENA_DAILY, market: { min: MARKET_MIN, max: MARKET_MAX } });

  /** Acciones nuevas con sesión. Devuelve `undefined` si la acción no es de este módulo. */
  async function handle(a: string, t: FTrainer, body: Any): Promise<unknown> {
    switch (a) {
      case 'team-set': return teamSet(t, body.ids);
      case 'gyms': return gymsView(t);
      case 'gym-start': return gymStart(t, Number(body.n));
      case 'arena': return arenaView(t);
      case 'arena-start': return arenaStart(t, String(body.id ?? ''));
      case 'duel': return duelGet(t);
      case 'duel-move': return duelMove(t, Number(body.i));
      case 'duel-leave': return duelLeave(t);
      case 'legends': return legendsView(t);
      case 'market': return marketView(t);
      case 'market-list': return marketList(t, String(body.id ?? ''), String(body.price ?? ''));
      case 'market-unlist': return marketUnlist(t, String(body.id ?? ''));
      case 'market-quote': return marketQuote(t, String(body.id ?? ''));
      case 'market-buy': return marketBuy(t, String(body.id ?? ''), String(body.txHash ?? ''));
    }
    return undefined;
  }

  return {
    handle, discovered, boostPts, buffsView, legendExtra, legendCheck, afterCatch, dexCheck, listedIds, mergeGuest,
    seasonNow, prizesConfig, isAddr,
  };
}
