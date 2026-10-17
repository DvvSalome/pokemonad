// Lo del jugador fuera del combate: su ficha (nivel, experiencia, monedas), el Poké Mart y los avisos de
// experiencia que saltan al responder bien o atrapar a un profesor.
//
// El Mart es el de PokeScout en espíritu —un mostrador de bolas con su precio— pero con las bolas pintadas
// de verdad (esfera con brillo, franja y botón, flotando) y packs con descuento. El perfil es el cuaderno
// del alumno: nivel y título, la barra de XP, lo que ha acertado, las insignias del Coliseo Monad y los
// apuntes de cada profesor atrapado.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BALLS, BALL_ORDER, type BallKey } from '../world/species';
import { addBalls, useCapture } from '../world/captureStore';
import { addBuff } from '../world/buffs';
import {
  REWARD, levelOf, spend, titleOf, useProgress, useToasts,
} from '../world/progressStore';
import { PROFESSORS, professorLesson } from '../world/professors';
import { BOSSES } from '../academy/questions';
import { useAcademy } from '../academy/academyStore';
import { portrait } from '../world/portrait';
import type { RosterEntry } from '../engine/avatar/characterRoster';
import { formatEther } from 'viem';
import { useLang } from '../i18n';
import { isOnline } from '../../lib/api';
import { useOnline } from '../world/online';
import { connect as connectWallet, shortAddr, useWallet } from '../world/walletStore';
import { buyWithCoins, buyWithMon, clearPay, loadMonMart, payBusy, syncFromServer, syncReady, useMonMart, usePay, useSync } from '../world/hubSync';
import './hub.css';

// ---------------------------------------------------------------- textos (es/en)

const TX = {
  es: {
    mart: 'Poké Mart', bag: 'Tu bolsa', coins: 'monedas', buy: 'Comprar', poor: 'Te faltan monedas',
    earn: `Gana monedas respondiendo bien en el Coliseo Monad (+${REWARD.correct.coins}), venciendo jefes (+${REWARD.win.coins}) y atrapando profesores (+${REWARD.catch.coins}).`,
    power: 'Potencia', sure: 'Captura segura', got: '¡A la bolsa!', radar: 'Radar de raros', radarDesc: 'Durante 20 min ves a los raros desde lejos.',
    profile: 'Perfil', level: 'Nivel', xp: 'XP', next: 'para el nivel', stats: 'Estadísticas', badges: 'Insignias del Coliseo Monad',
    correct: 'Aciertos', accuracy: 'Precisión', streak: 'Mejor racha', wins: 'Jefes vencidos', catches: 'Profesores', fights: 'Combates',
    notes: 'Apuntes', noNotes: 'Atrapa profesores en la hierba: cada uno te deja su lección aquí.', activity: 'Actividad reciente', noActivity: 'Responde preguntas en el Coliseo Monad para ganar experiencia.',
    pack: 'pack', off: 'ahorras', levelUp: '¡Subiste de nivel!', close: 'Cerrar', owned: 'tienes',
    connect: 'Conectar wallet', connecting: 'Conectando…', payCoins: 'Monedas', payMon: 'MON', monHint: 'Paga con MON de Monad: el servidor verifica la transacción y te entrega las bolas.',
    monWait: 'Cargando precios…', monSpent: 'MON gastado', saved: 'Progreso guardado en tu wallet', local: 'Solo en este navegador · conecta tu wallet para guardarlo',
    steps: { connecting: 'Conectando wallet…', signing: 'Confirma el pago en tu wallet…', confirming: 'Esperando a Monad…' }, faucet: 'Pedir MON de prueba', seeTx: 'Ver transacción',
    descs: { ball: 'La de siempre. Para profesores tranquilos.', super: 'Más fuerte: para los que se resisten.', hyper: 'La de los expertos.', hood: 'Nunca falla. Para el profesor que no quieres perder.' },
  },
  en: {
    mart: 'Poké Mart', bag: 'Your bag', coins: 'coins', buy: 'Buy', poor: 'Not enough coins',
    earn: `Earn coins by answering right in the Monad Colosseum (+${REWARD.correct.coins}), beating bosses (+${REWARD.win.coins}) and catching professors (+${REWARD.catch.coins}).`,
    power: 'Power', sure: 'Sure catch', got: 'Into the bag!', radar: 'Rare Radar', radarDesc: 'For 20 min, rare ones show from far away.',
    profile: 'Profile', level: 'Level', xp: 'XP', next: 'to level', stats: 'Stats', badges: 'Monad Colosseum badges',
    correct: 'Correct', accuracy: 'Accuracy', streak: 'Best streak', wins: 'Bosses beaten', catches: 'Professors', fights: 'Battles',
    notes: 'Notes', noNotes: 'Catch professors in the grass: each one leaves their lesson here.', activity: 'Recent activity', noActivity: 'Answer questions in the Monad Colosseum to earn experience.',
    pack: 'pack', off: 'save', levelUp: 'Level up!', close: 'Close', owned: 'owned',
    connect: 'Connect wallet', connecting: 'Connecting…', payCoins: 'Coins', payMon: 'MON', monHint: 'Pay with Monad MON: the server verifies the transaction and delivers your balls.',
    monWait: 'Loading prices…', monSpent: 'MON spent', saved: 'Progress saved to your wallet', local: 'Only in this browser · connect your wallet to save it',
    steps: { connecting: 'Connecting wallet…', signing: 'Confirm the payment in your wallet…', confirming: 'Waiting for Monad…' }, faucet: 'Get test MON', seeTx: 'View transaction',
    descs: { ball: 'The classic. For calm professors.', super: 'Stronger: for the ones who resist.', hyper: 'The experts’ ball.', hood: 'Never fails. For the professor you can’t lose.' },
  },
} as const;
const useTx = () => TX[useLang() === 'es' ? 'es' : 'en'];

// ---------------------------------------------------------------- la bola pintada

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Una bola en CSS: esfera con brillo, franja negra, botón blanco y el color de su tipo arriba. */
export const Ball: React.FC<{ kind: BallKey; size?: number; float?: boolean; className?: string }> = ({ kind, size = 56, float, className = '' }) => (
  <i
    className={`pb pb-${kind}${float ? ' float' : ''} ${className}`}
    style={{ ['--c' as string]: hex(BALLS[kind].color), width: size, height: size }}
    aria-hidden
  />
);

// ---------------------------------------------------------------- el Mart

/** Precios en MON de reserva (los de la migración / PokeMart.sol) mientras el servidor no responde. */
const MON_FALLBACK: Record<string, string> = { ball1: '0.002', ball10: '0.015', super1: '0.005', super5: '0.02', hyper1: '0.01', hyper3: '0.025', hood: '0.04', radar: '0.012' };

interface Good { id: string; kind: BallKey | 'radar'; qty: number; cost: number; base?: number }
/** Precio unitario de cada bola: los packs se calculan contra esto para enseñar el ahorro. */
const UNIT: Record<BallKey, number> = { ball: 5, super: 18, hyper: 45, hood: 200 };
const GOODS: Good[] = [
  { id: 'ball1', kind: 'ball', qty: 1, cost: UNIT.ball },
  { id: 'ball10', kind: 'ball', qty: 10, cost: 40, base: UNIT.ball * 10 },
  { id: 'super1', kind: 'super', qty: 1, cost: UNIT.super },
  { id: 'super5', kind: 'super', qty: 5, cost: 80, base: UNIT.super * 5 },
  { id: 'hyper1', kind: 'hyper', qty: 1, cost: UNIT.hyper },
  { id: 'hyper3', kind: 'hyper', qty: 3, cost: 120, base: UNIT.hyper * 3 },
  { id: 'hood', kind: 'hood', qty: 1, cost: UNIT.hood },
  { id: 'radar', kind: 'radar', qty: 1, cost: 60 },
];

/** Un número que corre hacia su valor (el monedero baja contando, no de golpe). */
function useCount(target: number, ms = 500) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      cur.current = from + (target - from) * (1 - Math.pow(1 - k, 3));
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return Math.round(v);
}

const Coin: React.FC<{ size?: number }> = ({ size = 18 }) => <i className="coin" style={{ width: size, height: size }} aria-hidden />;

export const Mart: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const tx = useTx();
  const p = useProgress();
  const cap = useCapture();
  const coins = useCount(p.coins);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [bump, setBump] = useState<{ kind: string; n: number } | null>(null);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'coins' | 'mon'>('coins');
  const mon = useMonMart();
  const pay = usePay();
  const sync = useSync();
  const wallet = useWallet();

  useEffect(() => { void loadMonMart(); clearPay(); }, [wallet.address]);
  useEffect(() => { if (mode === 'mon' && !mon) void loadMonMart(); }, [mode, mon]);

  const celebrate = (g: Good) => {
    const n = Date.now();
    setFlash({ id: g.id, n });
    setBump({ kind: g.kind, n });
  };
  // Un pago en MON entregado: mismo destello que una compra con monedas.
  const lastDone = useRef<string | null>(null);
  useEffect(() => {
    if (pay.phase === 'done' && pay.item && lastDone.current !== pay.hash) {
      lastDone.current = pay.hash;
      const g = GOODS.find((x) => x.id === pay.item);
      if (g) celebrate(g);
    }
  }, [pay.phase, pay.item, pay.hash]);

  const buy = async (g: Good) => {
    if (mode === 'mon') { setNote(''); void buyWithMon(g.id); return; }
    if (syncReady() && isOnline()) {
      if (!(await buyWithCoins(g.id))) { setNote(tx.poor); return; }
    } else {
      if (!spend(g.cost)) { setNote(tx.poor); return; }
      if (g.kind === 'radar') addBuff('radar', 20);
      else addBalls({ [g.kind]: g.qty });
    }
    setNote('');
    celebrate(g);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="hb-back" onClick={onClose}>
      <div className="hb-mart" onClick={(e) => e.stopPropagation()}>
        <div className="awning" aria-hidden />
        <header>
          <div className="sign"><b>{tx.mart}</b></div>
          <div className="paymode" role="tablist">
            <button className={mode === 'coins' ? 'on' : ''} onClick={() => setMode('coins')}><Coin size={14} /> {tx.payCoins}</button>
            <button className={mode === 'mon' ? 'on' : ''} onClick={() => setMode('mon')}><i className="mon" aria-hidden>M</i> {tx.payMon}</button>
          </div>
          <span className="purse"><Coin size={22} /><b>{coins}</b><small>{tx.coins}</small></span>
          <button className="x" onClick={onClose} aria-label={tx.close}>✕</button>
        </header>

        <div className="shelf">
          {GOODS.map((g, i) => {
            const isBall = g.kind !== 'radar';
            const monItem = mon?.items.find((i) => i.item === g.id);
            const monPrice = monItem?.priceMon ?? MON_FALLBACK[g.id];
            const afford = mode === 'mon' ? !payBusy() : p.coins >= g.cost;
            const save = g.base ? Math.round((1 - g.cost / g.base) * 100) : 0;
            const mult = isBall ? BALLS[g.kind as BallKey].mult : 0;
            return (
              <div
                key={g.id}
                className={`good${afford || mode === 'mon' ? '' : ' poor'}${pay.phase !== 'idle' && pay.item === g.id && mode === 'mon' ? ' paying' : ''}`}
                style={{ ['--i' as string]: i, ['--c' as string]: isBall ? hex(BALLS[g.kind as BallKey].color) : '#4fd1c5' }}
              >
                {/* Destello de compra: lleva la marca de tiempo como key para repetirse en cada compra. */}
                {flash?.id === g.id && <i className="burst" key={`b${flash.n}`} />}
                {save > 0 && <span className="ribbon">−{save}%</span>}
                <div className="stage">
                  {isBall ? (
                    g.qty > 1 ? (
                      <span className="stack">
                        <Ball kind={g.kind as BallKey} size={44} />
                        <Ball kind={g.kind as BallKey} size={44} />
                        <Ball kind={g.kind as BallKey} size={52} float />
                      </span>
                    ) : <Ball kind={g.kind as BallKey} size={62} float />
                  ) : <i className="radar" aria-hidden><i /><i /></i>}
                  {g.qty > 1 && <em className="qty">×{g.qty}</em>}
                </div>
                <b className="nm">{isBall ? BALLS[g.kind as BallKey].name : tx.radar}</b>
                <small className="ds">{isBall ? tx.descs[g.kind as BallKey] : tx.radarDesc}</small>
                {isBall && <span className="pw">{mult === Infinity ? tx.sure : `${tx.power} ×${mult}`}</span>}
                <button className="price" disabled={!afford} onClick={() => void buy(g)}>
                  {mode === 'mon'
                    ? <><i className="mon" aria-hidden>M</i> {monPrice}</>
                    : <><Coin /> {g.cost}</>}
                </button>
                {flash?.id === g.id && <span className="pop" key={flash.n}>{tx.got}</span>}
              </div>
            );
          })}
        </div>

        <footer>
          <div className="bag">
            <b>{tx.bag}</b>
            <div className="slots">
              {BALL_ORDER.map((k) => (
                <span key={k} className="slot">
                  <span className={bump?.kind === k ? 'hop' : ''} key={bump?.kind === k ? bump.n : 0}><Ball kind={k} size={28} /></span>
                  <em>×{cap.balls[k]}</em>
                </span>
              ))}
            </div>
          </div>
          <p className={`earn${pay.phase !== 'idle' ? ' pay ' + pay.phase : ''}`}>
            {pay.phase === 'idle' || mode === 'coins'
              ? (note ? <span className="warn">{note}</span> : (mode === 'mon' ? tx.monHint : tx.earn))
              : (
                <>
                  {pay.phase === 'error' ? <span className="warn">{pay.msg}</span>
                    : pay.phase === 'done' ? <b className="ok">{pay.msg}</b>
                    : <span><i className="spin" /> {tx.steps[pay.phase as 'connecting' | 'signing' | 'confirming']}</span>}
                  {pay.explorer && <> <a href={pay.explorer} target="_blank" rel="noreferrer">{tx.seeTx} ↗</a></>}
                  {pay.faucet && <> <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">{tx.faucet} ↗</a></>}
                </>
              )}
            {sync.ready && mode === 'coins' && !note && <small className="saved"> · {tx.saved}</small>}
          </p>
        </footer>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- el perfil

const LevelRing: React.FC<{ pct: number; size: number; stroke?: number; children?: React.ReactNode }> = ({ pct, size, stroke = 5, children }) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="trk" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} className="val" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      {children}
    </span>
  );
};

function usePortrait(model: string) {
  const [img, setImg] = useState('');
  useEffect(() => {
    let alive = true;
    setImg('');
    portrait(model, { bust: true }).then((u) => alive && setImg(u)).catch(() => {});
    return () => { alive = false; };
  }, [model]);
  return img;
}

const ago = (t: number, es: boolean) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return es ? 'ahora' : 'now';
  if (m < 60) return es ? `hace ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  return es ? `hace ${h} h` : `${h} h ago`;
};

export const Profile: React.FC<{ character: RosterEntry; onClose: () => void }> = ({ character, onClose }) => {
  const tx = useTx();
  const lang = useLang();
  const es = lang === 'es';
  const p = useProgress();
  const academy = useAcademy();
  const wallet = useWallet();
  const sync = useSync();
  const lv = levelOf(p.xp);
  const pic = usePortrait(character.modelo_url);
  const answered = p.correct + p.wrong;
  const acc = answered ? Math.round((p.correct / answered) * 100) : 0;
  const xpShown = useCount(lv.into, 900);
  const notes = useMemo(() => p.notes.map((id) => ({
    id, who: PROFESSORS.find((x) => x.id === id)?.species.name ?? id, text: professorLesson(id) ?? '',
  })).reverse(), [p.notes, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stats: [string, string | number][] = [
    [tx.correct, p.correct],
    [tx.accuracy, answered ? `${acc}%` : '—'],
    [tx.streak, p.bestStreak],
    [tx.wins, p.battlesWon],
    [tx.fights, p.battlesWon + p.battlesLost],
    [tx.catches, p.catches],
  ];

  return (
    <div className="hb-back" onClick={onClose}>
      <div className="hb-profile" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label={tx.close}>✕</button>
        <section className="id">
          <LevelRing pct={lv.pct} size={150} stroke={7}>
            <span className="pic">{pic ? <img src={pic} alt="" /> : <i>{character.emoji}</i>}</span>
            <span className="lvchip">{tx.level} {lv.level}</span>
          </LevelRing>
          <h2>{character.nombre}</h2>
          <p className="title">{titleOf(lv.level, lang)}</p>
          <div className="xpbar">
            <div className="track"><i style={{ width: `${lv.pct * 100}%` }} /></div>
            <span><b>{xpShown}</b> / {lv.need} {tx.xp}</span>
            <small>{lv.need - lv.into} {tx.xp} {tx.next} {lv.level + 1}</small>
          </div>
          <div className="mini">
            <span><Coin /> <b>{p.coins}</b> {tx.coins}</span>
            <span>✦ <b>{p.xp}</b> {tx.xp}</span>
          </div>
          {(wallet.address ?? academy.address) && <code className="addr">{shortAddr(wallet.address ?? academy.address!)}</code>}
          {sync.monSpent !== '0' && <span className="monspent"><i className="mon" aria-hidden>M</i> {Number(formatEther(BigInt(sync.monSpent.split('.')[0]))).toFixed(3)} {tx.monSpent}</span>}
          <small className={`syncnote${sync.ready ? ' on' : ''}`}>{sync.ready ? tx.saved : tx.local}</small>
        </section>

        <section className="body">
          <h3>{tx.stats}</h3>
          <div className="stats">
            {stats.map(([k, v], i) => (
              <div key={k} className="stat" style={{ ['--i' as string]: i }}><b>{v}</b><span>{k}</span></div>
            ))}
          </div>

          <h3>{tx.badges}</h3>
          <div className="badges">
            {BOSSES.map((b) => {
              const on = ((academy.badges | sync.badges) & (1 << b.id)) !== 0;
              return (
                <div key={b.key} className={`badge${on ? ' on' : ''}`} style={{ ['--c' as string]: hex(b.color) }}>
                  <i>{on ? '★' : '?'}</i>
                  <span>{b.name}</span>
                  <small>{b.level}</small>
                </div>
              );
            })}
          </div>

          <h3>{tx.notes} <em>{notes.length}</em></h3>
          {notes.length ? (
            <ul className="notes">
              {notes.map((n) => <li key={n.id}><b>{n.who}</b><p>{n.text}</p></li>)}
            </ul>
          ) : <p className="empty">{tx.noNotes}</p>}

          <h3>{tx.activity}</h3>
          {p.log.length ? (
            <ul className="log">
              {p.log.slice(0, 6).map((a) => (
                <li key={a.t + a.text}>
                  <span>{a.text}</span>
                  <b>+{a.xp} {tx.xp}{a.coins ? <> · +{a.coins} <Coin size={12} /></> : null}</b>
                  <small>{ago(a.t, es)}</small>
                </li>
              ))}
            </ul>
          ) : <p className="empty">{tx.noActivity}</p>}
        </section>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- la ficha del HUD

/** Arriba a la izquierda: retrato con el anillo de nivel, la barra de XP y el monedero; abre perfil y Mart. */
export const PlayerHub: React.FC<{ character: RosterEntry }> = ({ character }) => {
  const tx = useTx();
  const p = useProgress();
  const cap = useCapture();
  const lv = levelOf(p.xp);
  const pic = usePortrait(character.modelo_url);
  const coins = useCount(p.coins);
  const [open, setOpen] = useState<null | 'mart' | 'profile'>(null);
  const wallet = useWallet();
  const online = useOnline();
  // Cuando la cuenta del servidor ya es la de la wallet conectada: subir lo local y bajar lo guardado.
  useEffect(() => {
    if (wallet.address && online.trainer?.wallet === wallet.address.toLowerCase()) void syncFromServer(wallet.address);
  }, [wallet.address, online.trainer?.wallet]);
  if (cap.activeId) return null;
  return (
    <>
      <div className="hb-chip">
        <button className="me" onClick={() => setOpen('profile')} title={tx.profile}>
          <LevelRing pct={lv.pct} size={58} stroke={4}>
            <span className="pic">{pic ? <img src={pic} alt="" /> : <i>{character.emoji}</i>}</span>
          </LevelRing>
          <span className="txt">
            <b>{character.nombre}</b>
            <small>{tx.level} {lv.level} · {lv.into}/{lv.need} {tx.xp}</small>
            <span className="bar"><i style={{ width: `${lv.pct * 100}%` }} /></span>
          </span>
        </button>
        <button className="shop" onClick={() => setOpen('mart')}>
          <Ball kind="ball" size={22} />
          <span>{tx.mart}</span>
          <em><Coin size={14} /> {coins}</em>
        </button>
        <button className={`wal${wallet.status === 'connected' ? ' on' : ''}`} disabled={wallet.status === 'connecting'}
          onClick={() => { if (wallet.status !== 'connected') void connectWallet(); else setOpen('profile'); }}
          title={wallet.error ?? undefined}>
          <i className="mon" aria-hidden>M</i>
          {wallet.status === 'connected' && wallet.address
            ? <span>{shortAddr(wallet.address)}{wallet.usdc ? <em>{wallet.usdc} MON</em> : null}</span>
            : <span>{wallet.status === 'connecting' ? tx.connecting : tx.connect}</span>}
        </button>
      </div>
      {open === 'mart' && <Mart onClose={() => setOpen(null)} />}
      {open === 'profile' && <Profile character={character} onClose={() => setOpen(null)} />}
    </>
  );
};

// ---------------------------------------------------------------- avisos de experiencia

/** "+25 XP" que sube y se desvanece; al subir de nivel, un cartel grande con rayos. Siempre montado. */
export const ProgressToasts: React.FC = () => {
  const toasts = useToasts();
  const tx = useTx();
  const lang = useLang();
  return (
    <div className="hb-toasts" aria-live="polite">
      {toasts.map((t) => (
        t.levelUp ? (
          <div key={t.id} className="hb-level">
            <i className="rays" />
            <small>{tx.levelUp}</small>
            <b>{tx.level} {t.levelUp}</b>
            <span>{titleOf(t.levelUp, lang)}</span>
          </div>
        ) : (
          <div key={t.id} className="hb-toast">
            <b>+{t.xp} {tx.xp}</b>
            {t.coins > 0 && <em><Coin size={14} /> +{t.coins}</em>}
            <span>{t.text}</span>
          </div>
        )
      ))}
    </div>
  );
};
