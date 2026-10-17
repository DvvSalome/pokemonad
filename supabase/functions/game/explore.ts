// Progreso del modo exploración (XP, monedas, historial) y el Poké Mart cobrado en MON nativo de Monad.
//
// Tablas: player_progress, player_history, quiz_answers, mart_catalog y mon_purchases (migración
// 20261017120000). El cliente solo cuenta qué pasó ("acerté la pregunta X del jefe 1"); cuánta XP vale lo
// decide este archivo, y la racha también la lleva el servidor, para que nadie se regale experiencia.
//
// Pago en MON: con contrato (MON_MART_CONTRACT, contracts/PokeMart.sol) se lee el evento Purchased del recibo;
// sin él, vale un envío directo de MON a la tesorería (MON_TREASURY) por al menos el precio.
// Se monta desde index.ts con `makeExplore(ctx)`, igual que features.ts.
import { createPublicClient, decodeEventLog, formatEther, http, parseAbi, parseEther } from 'npm:viem@2';
import { BALL_KEYS, type BallKey } from './pokemath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface XTrainer { id: string; name: string; wallet: string | null; balls: Record<BallKey, number>; buffs: Record<string, number> }
export interface XCtx {
  db: Any;
  fail: (msg: string, status?: number) => Error;
  envOr: (k: string, d: string) => string;
  saveTrainer: (t: Any, patch: Any) => Promise<void>;
  publicTrainer: (t: Any) => Any;
}

/** Lo que paga cada cosa. Tiene que coincidir con REWARD de src/world/progressStore.ts. */
const REWARD = {
  correct: { xp: 25, coins: 10 }, streakXp: 5, streakCap: 6,
  wrong: { xp: 5, coins: 0 },
  win: { xp: 150, coins: 80 }, loss: { xp: 20, coins: 0 },
  catch: { xp: 40, coins: 15 },
} as const;
/** Al subir la partida del navegador por primera vez, hasta aquí se acepta sin más preguntas. */
const IMPORT_CAP = { xp: 3000, coins: 1500 };
const ANSWER_GAP_MS = 1500;
const ANSWERS_PER_DAY = 600;
const PAY_MAX_AGE_S = 24 * 3600;
const isAddr = (a: string) => /^0x[0-9a-f]{40}$/.test(a);

const PURCHASED = parseAbi(['event Purchased(address indexed buyer, uint8 indexed item, uint8 count, uint256 paid, uint256 indexed orderId)']);

export function makeExplore(c: XCtx) {
  const { db, fail } = c;
  const MON = {
    chainId: Number(c.envOr('MON_CHAIN_ID', '10143')),
    rpc: c.envOr('MON_RPC_URL', 'https://testnet-rpc.monad.xyz'),
    explorer: c.envOr('MON_EXPLORER', 'https://testnet.monadvision.com'),
    contract: c.envOr('MON_MART_CONTRACT', '').toLowerCase(),
    treasury: c.envOr('MON_TREASURY', c.envOr('TREASURY_ADDRESS', '')).toLowerCase(),
  };
  const chain = createPublicClient({ transport: http(MON.rpc, { timeout: 8_000, retryCount: 1 }) });

  // ---------------------------------------------------------------- lectura
  async function catalog() {
    const { data, error } = await db.from('mart_catalog').select('*').eq('active', true).order('sort');
    if (error) throw fail(error.message, 500);
    return data as { item: string; onchain_id: number; name: string; balls: Partial<Record<BallKey, number>>; buff: string | null; minutes: number | null; price_mon: string | number; price_coins: number | null }[];
  }

  async function progressOf(t: XTrainer) {
    const { data } = await db.from('player_progress').select('*').eq('trainer_id', t.id).maybeSingle();
    if (data) return data;
    const { data: made, error } = await db.from('player_progress').insert({ trainer_id: t.id }).select('*').single();
    if (error) throw fail(error.message, 500);
    return made;
  }

  async function history(t: XTrainer, limit = 30) {
    const { data } = await db.from('player_history').select('kind,text,xp,coins,meta,tx_hash,created_at')
      .eq('trainer_id', t.id).order('created_at', { ascending: false }).limit(limit);
    return data ?? [];
  }

  async function view(t: XTrainer) {
    const [progress, log] = await Promise.all([progressOf(t), history(t)]);
    return { progress, history: log, trainer: c.publicTrainer(t) };
  }

  async function gain(t: XTrainer, kind: string, text: string, xp: number, coins: number, o: { patch?: Any; set?: Any; meta?: Any; tx?: string } = {}) {
    const { data, error } = await db.rpc('progress_gain', {
      p_trainer: t.id, p_kind: kind, p_text: text, p_xp: xp, p_coins: coins,
      p_patch: o.patch ?? {}, p_set: o.set ?? {}, p_meta: o.meta ?? {}, p_tx: o.tx ?? null,
    });
    if (error) throw fail(error.message, 500);
    return data;
  }

  // ---------------------------------------------------------------- eventos de juego
  async function answer(t: XTrainer, boss: number, questionId: string, ok: boolean, es: boolean) {
    if (![0, 1, 2].includes(boss)) throw fail('unknown boss');
    const qid = questionId.slice(0, 64);
    if (!qid) throw fail('missing question');
    const { data: last } = await db.from('quiz_answers').select('created_at').eq('trainer_id', t.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.created_at) < ANSWER_GAP_MS) throw fail('too fast', 429);
    const { count } = await db.from('quiz_answers').select('id', { count: 'exact', head: true })
      .eq('trainer_id', t.id).gte('created_at', new Date(Date.now() - 864e5).toISOString());
    if ((count ?? 0) >= ANSWERS_PER_DAY) throw fail('that is enough study for today', 429);

    const p = await progressOf(t);
    const streak = ok ? p.streak + 1 : 0;
    await db.from('quiz_answers').insert({ trainer_id: t.id, boss, question_id: qid, ok, streak });
    if (ok) {
      const bonus = Math.min(REWARD.streakCap, Math.max(0, streak - 1)) * REWARD.streakXp;
      const text = es ? (bonus ? `Respuesta correcta · racha ×${streak}` : 'Respuesta correcta') : (bonus ? `Correct answer · streak ×${streak}` : 'Correct answer');
      const progress = await gain(t, 'answer', text, REWARD.correct.xp + bonus, REWARD.correct.coins,
        { patch: { correct: 1 }, set: { streak }, meta: { boss, question: qid, ok } });
      return { progress, xp: REWARD.correct.xp + bonus, coins: REWARD.correct.coins, streak };
    }
    const progress = await gain(t, 'answer', es ? 'Fallo, pero aprendiste algo' : 'Missed it, but learned something',
      REWARD.wrong.xp, REWARD.wrong.coins, { patch: { wrong: 1 }, set: { streak: 0 }, meta: { boss, question: qid, ok } });
    return { progress, xp: REWARD.wrong.xp, coins: REWARD.wrong.coins, streak: 0 };
  }

  async function battle(t: XTrainer, boss: number, win: boolean, name: string, es: boolean) {
    if (![0, 1, 2].includes(boss)) throw fail('unknown boss');
    const nm = name.slice(0, 48);
    if (win) {
      // Una victoria solo cuenta si hubo pelea de verdad: aciertos contra ese jefe en el último cuarto de hora.
      const { count } = await db.from('quiz_answers').select('id', { count: 'exact', head: true })
        .eq('trainer_id', t.id).eq('boss', boss).eq('ok', true).gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString());
      if ((count ?? 0) < 3) throw fail('no battle on record against that boss', 409);
      const progress = await gain(t, 'battle', es ? `Derrotaste a ${nm}` : `Defeated ${nm}`, REWARD.win.xp, REWARD.win.coins,
        { patch: { battles_won: 1 }, set: { badge_bit: 1 << boss }, meta: { boss, win } });
      return { progress, xp: REWARD.win.xp, coins: REWARD.win.coins };
    }
    const progress = await gain(t, 'battle', es ? `Combate contra ${nm}` : `Fought ${nm}`, REWARD.loss.xp, REWARD.loss.coins,
      { patch: { battles_lost: 1 }, meta: { boss, win } });
    return { progress, xp: REWARD.loss.xp, coins: REWARD.loss.coins };
  }

  async function caught(t: XTrainer, id: string, name: string, es: boolean) {
    const pid = id.slice(0, 64);
    const p = await progressOf(t);
    if (p.notes.includes(pid)) return { progress: p, xp: 0, coins: 0 };
    const nm = name.slice(0, 48);
    const progress = await gain(t, 'catch', es ? `Atrapaste a ${nm}` : `Caught ${nm}`, REWARD.catch.xp, REWARD.catch.coins,
      { patch: { catches: 1 }, set: { note: pid }, meta: { id: pid } });
    return { progress, xp: REWARD.catch.xp, coins: REWARD.catch.coins };
  }

  /** La primera vez que una wallet entra, sube lo que llevaba jugado en ese navegador (con tope). */
  async function importLocal(t: XTrainer, local: Any) {
    const p = await progressOf(t);
    if (p.imported || p.xp > 0) return view(t);
    const n = (v: unknown, max = 1e6) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    const notes = Array.isArray(local?.notes) ? local.notes.filter((x: unknown) => typeof x === 'string').slice(0, 64).map((x: string) => x.slice(0, 64)) : [];
    await db.from('player_progress').update({
      xp: n(local?.xp, IMPORT_CAP.xp), coins: n(local?.coins, IMPORT_CAP.coins),
      correct: n(local?.correct, 5000), wrong: n(local?.wrong, 5000), best_streak: n(local?.bestStreak, 500),
      battles_won: n(local?.battlesWon, 500), battles_lost: n(local?.battlesLost, 500), catches: n(local?.catches, 500),
      notes, imported: true, updated_at: new Date().toISOString(),
    }).eq('trainer_id', t.id);
    await db.from('player_history').insert({ trainer_id: t.id, kind: 'import', text: 'Partida del navegador', xp: n(local?.xp, IMPORT_CAP.xp), coins: 0 });
    return view(t);
  }

  // ---------------------------------------------------------------- Mart
  function grant(t: XTrainer, it: { balls: Partial<Record<BallKey, number>>; buff: string | null; minutes: number | null }, count: number) {
    const balls = { ...t.balls };
    for (const k of BALL_KEYS) balls[k] = (balls[k] ?? 0) + (it.balls?.[k] ?? 0) * count;
    const buffs = { ...t.buffs };
    if (it.buff && it.minutes) buffs[it.buff] = Math.max(buffs[it.buff] ?? 0, Date.now()) + it.minutes * 60_000 * count;
    return { balls, buffs };
  }

  async function martInfo() {
    const items = await catalog();
    return {
      chainId: MON.chainId, explorer: MON.explorer,
      contract: isAddr(MON.contract) ? MON.contract : null,
      treasury: isAddr(MON.treasury) ? MON.treasury : null,
      ready: isAddr(MON.contract) || isAddr(MON.treasury),
      items: items.map((i) => ({ item: i.item, onchainId: i.onchain_id, name: i.name, balls: i.balls, buff: i.buff, minutes: i.minutes,
        priceMon: String(i.price_mon), priceWei: parseEther(String(i.price_mon)).toString(), priceCoins: i.price_coins })),
    };
  }

  async function coinBuy(t: XTrainer, item: string) {
    const it = (await catalog()).find((i) => i.item === item);
    if (!it || it.price_coins == null) throw fail('unknown item');
    const { data, error } = await db.rpc('progress_spend', { p_trainer: t.id, p_cost: it.price_coins, p_text: it.name, p_meta: { item } });
    if (error) throw fail(error.message, 500);
    if (!data) throw fail('not enough coins', 402);
    const patch = grant(t, it, 1);
    await c.saveTrainer(t, patch);
    return { progress: data, trainer: c.publicTrainer(t), granted: it.balls };
  }

  /** Comprueba en Monad que `hash` es un pago válido de la wallet de la cuenta por `count` unidades de `it`. */
  async function verifyMon(t: XTrainer, hash: `0x${string}`, it: { onchain_id: number; price_mon: string | number }, count: number) {
    const wallet = t.wallet!.toLowerCase();
    let rc;
    try {
      rc = await chain.getTransactionReceipt({ hash });
    } catch (e) {
      if ((e as Error)?.name !== 'TransactionReceiptNotFoundError') throw fail('could not reach Monad, try again', 502);
      const pending = await chain.getTransaction({ hash }).catch(() => null);
      throw pending ? fail('payment not confirmed yet', 425) : fail('transaction not found on Monad', 404);
    }
    if (rc.status !== 'success') throw fail('that transaction failed on-chain', 402);
    if (rc.from.toLowerCase() !== wallet) throw fail('that payment was not sent from your wallet', 402);
    const min = parseEther(String(it.price_mon)) * BigInt(count);
    const to = rc.to?.toLowerCase() ?? '';

    let paid = 0n, via: 'contract' | 'transfer', orderId: bigint | null = null, n = count;
    if (isAddr(MON.contract) && to === MON.contract) {
      via = 'contract';
      for (const l of rc.logs) {
        if (l.address.toLowerCase() !== MON.contract) continue;
        try {
          const ev = decodeEventLog({ abi: PURCHASED, data: l.data, topics: l.topics });
          if (ev.args.buyer.toLowerCase() !== wallet || Number(ev.args.item) !== it.onchain_id) continue;
          paid = ev.args.paid; orderId = ev.args.orderId; n = Number(ev.args.count);
        } catch { /* otro evento */ }
      }
      if (!paid) throw fail('no Poké Mart purchase of that item in that transaction', 402);
      if (n !== count) throw fail('the purchase was for a different amount', 402);
    } else if (isAddr(MON.treasury) && to === MON.treasury) {
      via = 'transfer';
      const tx = await chain.getTransaction({ hash }).catch(() => null);
      if (!tx) throw fail('could not reach Monad, try again', 502);
      paid = tx.value;
    } else throw fail('that transaction did not pay the Poké Mart', 402);

    if (paid < min) throw fail(`payment too small: ${formatEther(paid)} MON`, 402);
    const block = await chain.getBlock({ blockNumber: rc.blockNumber }).catch(() => null);
    if (!block) throw fail('could not reach Monad, try again', 502);
    if (Date.now() / 1000 - Number(block.timestamp) > PAY_MAX_AGE_S) throw fail('that payment is too old', 402);
    return { paid, via, orderId, block: rc.blockNumber };
  }

  async function monBuy(t: XTrainer, item: string, count: number, txHash: string, es: boolean) {
    if (!t.wallet) throw fail('connect your wallet first', 403);
    const hash = txHash.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw fail('pay with your wallet first (missing transaction)', 402);
    const n = Math.floor(count) || 1;
    if (n < 1 || n > 20) throw fail('bad amount');
    const it = (await catalog()).find((i) => i.item === item);
    if (!it) throw fail('unknown item');
    const { data: used } = await db.from('mon_purchases').select('tx_hash').eq('tx_hash', hash).maybeSingle();
    if (used) throw fail('that payment was already used', 409);

    const v = await verifyMon(t, hash as `0x${string}`, it, n);
    const { error } = await db.from('mon_purchases').insert({
      tx_hash: hash, trainer_id: t.id, wallet: t.wallet, item, count: n, value_wei: v.paid.toString(),
      chain_id: MON.chainId, block: Number(v.block), via: v.via, order_id: v.orderId === null ? null : Number(v.orderId),
    });
    if (error) {
      const dup = /duplicate/i.test(error.message);
      throw fail(dup ? 'that payment was already used' : error.message, dup ? 409 : 500);
    }
    await c.saveTrainer(t, grant(t, it, n));
    const mon = formatEther(v.paid);
    const progress = await gain(t, 'purchase', es ? `Compraste ${it.name}${n > 1 ? ` ×${n}` : ''} · ${mon} MON` : `Bought ${it.name}${n > 1 ? ` ×${n}` : ''} · ${mon} MON`,
      0, 0, { patch: { mon_spent: v.paid.toString() }, meta: { item, count: n, via: v.via }, tx: hash });
    return { progress, trainer: c.publicTrainer(t), granted: it.balls, count: n, paid: mon, txHash: hash, explorer: `${MON.explorer}/tx/${hash}` };
  }

  async function leaderboard() {
    const { data } = await db.from('xp_leaderboard').select('*').order('rank').limit(20);
    return { rows: data ?? [] };
  }

  /** Acciones públicas (sin sesión). undefined = no es de este módulo. */
  async function handlePublic(a: string): Promise<unknown> {
    if (a === 'mon-mart') return martInfo();
    if (a === 'xp-board') return leaderboard();
    return undefined;
  }

  async function handle(a: string, t: XTrainer, body: Any): Promise<unknown> {
    const es = body?.lang === 'es';
    switch (a) {
      case 'progress': return view(t);
      case 'progress-import': return importLocal(t, body.local);
      case 'progress-answer': return answer(t, Number(body.boss), String(body.questionId ?? ''), !!body.ok, es);
      case 'progress-battle': return battle(t, Number(body.boss), !!body.win, String(body.name ?? ''), es);
      case 'progress-catch': return caught(t, String(body.id ?? ''), String(body.name ?? ''), es);
      case 'coin-buy': return coinBuy(t, String(body.item ?? ''));
      case 'mon-buy': return monBuy(t, String(body.item ?? ''), Number(body.count ?? 1), String(body.txHash ?? ''), es);
      default: return undefined;
    }
  }

  return { handle, handlePublic };
}
