// Capa de interfaz del combate 3D (el combate en sí se ve en el estadio, BattleArena.tsx), con el lenguaje
// "premium" de la selección de personaje: paneles azul noche con filo dorado, azul Arc y oro. Arriba, las
// dos placas enfrentadas con su vida (baja suave, destella al recibir, late con poca vida); abajo, el
// narrador y los ataques como cartas del color de su tipo (al pasar el ratón, daño estimado y la franja que
// quitaría en la barra del rival). Más la cortinilla, el cartel VS, los avisos de crítico/súper eficaz, el
// K.O. y la pantalla final con resumen escalonado (y confeti si ganas).
//
// Teclado: 1 y 2 atacan, B vuelve a la bola, Esc huye.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TYPE_COLORS } from '../world/species';
import { useCapture, getFoeHp, getFoeMax } from '../world/captureStore';
import { useBattle, chooseMove, fleeBattle, endBattle, effectiveness, getBattle, type BattleState } from '../world/battleStore';
import type { Move, Stats } from '../world/battleMath';
import { portrait } from '../world/portrait';
import { music, sfx, crowd, isMuted, setMuted, subscribeMute } from '../audio/sound';
import { bsfx } from '../audio/battleSfx';
import { INTRO } from '../world/arenaLayout';
import { t, useT } from '../i18n';
import './polish/battle.css';

/** Música y efectos siguiendo el combate: cada cambio de estado del battleStore suena en su momento. */
function useBattleAudio(b: BattleState) {
  useEffect(() => { if (b.wipe) sfx.wipe(); }, [b.wipe]);

  const inStage = b.active && b.view === 'arena';
  useEffect(() => {
    if (!inStage) { music.stop(); crowd.stop(); return; }
    music.start();
    crowd.start();
    // Mismo guion que la presentación del estadio (arenaLayout.INTRO): cartel VS, ovación, aparece el salvaje, bola, sale el tuyo.
    const ms = (s: number) => s * 1000;
    const ts = [
      setTimeout(bsfx.vsWhoosh, ms(INTRO.vsAt)),
      setTimeout(() => { bsfx.vsSlam(); crowd.swell(0.7); }, ms(INTRO.vsSlam)),
      setTimeout(bsfx.vsWhoosh, ms(INTRO.vsEnd - 0.1)),
      setTimeout(() => { sfx.cheer(); crowd.swell(0.8); }, ms(INTRO.vsEnd)),
      setTimeout(sfx.appear, ms(INTRO.foeAt)),
      setTimeout(sfx.throwBall, ms(INTRO.ballAt)),
      setTimeout(() => { sfx.pop(); crowd.swell(0.6); }, ms(INTRO.ballEnd)),
    ];
    return () => ts.forEach(clearTimeout);
  }, [inStage]);

  const a = b.anim;
  useEffect(() => {
    if (!a) return;
    if (a.phase === 'wind') {
      sfx.cast(a.type);
      if (a.dmg > 0 && a.eff >= 2) sfx.sting();
    } else if (a.dmg > 0 && a.eff !== 0) {
      sfx.hit(a.eff >= 2 || a.crit, a.ko);
      if (a.crit) bsfx.crit();
      crowd.swell(a.ko ? 1.4 : a.eff >= 2 || a.crit ? 1 : 0.5);
    } else sfx.miss();
  }, [a?.id, a?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!b.active || b.turn !== 'over' || b.result === 'flee') return;
    music.stop(0.3);
    const tm = setTimeout(() => {
      if (b.result === 'win') { music.victory(); sfx.cheer(); crowd.swell(2); bsfx.confetti(); } else music.defeat();
    }, 650);
    return () => clearTimeout(tm);
  }, [b.active, b.turn, b.result]);

  const danger = inStage && b.turn !== 'over' && b.pMax > 0 && b.pHp / b.pMax <= 0.25;
  useEffect(() => { music.setDanger(danger); }, [danger]);
}

/** Número que corre hacia su objetivo (la cifra de vida baja a la par que la barra). */
function useTween(target: number, ms = 650, delay = 0) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / ms));
      const e = 1 - Math.pow(1 - k, 3);
      cur.current = from + (target - from) * e;
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return v;
}

const MuteButton: React.FC = () => {
  const muted = useSyncExternalStore(subscribeMute, isMuted, isMuted);
  return (
    <button className={`pg-bt-mute${muted ? ' off' : ''}`} onClick={() => setMuted(!muted)} title={t(muted ? 'battle.unmute' : 'battle.mute')} aria-label={t('battle.sound')}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {muted
          ? <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
      </svg>
    </button>
  );
};

/** Elegir ataque con un clic de interfaz audible (el sonido del ataque llega después, con el golpe). */
const pick = (i: number) => { if (getBattle().turn === 'choose') sfx.ui(); chooseMove(i); };

const typeColor = (ty: string) => TYPE_COLORS[ty as keyof typeof TYPE_COLORS] ?? '#888';
const tcVar = (ty: string) => ({ ['--tc' as string]: typeColor(ty) });

/** Horquilla de daño del ataque (misma fórmula que damageOf, ±10%); solo informativa. */
function estimate(m: Move, eff: number, A: Stats, D: Stats) {
  if (eff === 0) return { min: 0, max: 0 };
  const mean = m.power * (0.55 + 0.6 * (A.atk / Math.max(20, D.def))) * eff;
  return { min: Math.max(1, Math.round(mean * 0.9)), max: Math.max(1, Math.round(mean * 1.1)) };
}

interface PlateProps {
  side: 'player' | 'foe'; name: string; level: number; type: string; hp: number; max: number; pic: string;
  wild?: boolean; hit: { id: number; big: boolean } | null; preview?: number; out?: boolean;
}
const Plate: React.FC<PlateProps> = ({ side, name, level, type, hp, max, pic, wild, hit, preview = 0, out }) => {
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * hp) / max)) : 0;
  const after = max > 0 ? Math.max(0, (100 * (hp - preview)) / max) : 0;
  const cls = pct > 50 ? 'ok' : pct > 20 ? 'mid' : 'low';
  const shown = useTween(Math.max(0, hp), 700);
  return (
    <div className={`pg-bt-plate ${side}${pct > 0 && pct <= 25 ? ' danger' : ''}${out ? ' out' : ''}`} style={tcVar(type)}>
      <div className={`in${hit ? (hit.big ? ' hurt big' : ' hurt') : ''}`} key={hit?.id ?? 0}>
        <div className="pic">{pic ? <img src={pic} alt="" /> : null}</div>
        <div className="body">
          <div className="row">
            <b className="nm">{name}</b>
            <span className="lv">{t('battle.lv', { n: level })}</span>
          </div>
          <div className="hp">
            <span className="lab">HP</span>
            <div className="track">
              <i className="ghost" style={{ width: `${pct}%` }} />
              <i className={`fill ${cls}`} style={{ width: `${pct}%` }} />
              {preview > 0 && <i className="prev" style={{ left: `${after}%`, width: `${pct - after}%` }} />}
            </div>
          </div>
          <div className="row sub">
            <span className="ty">{type}</span>
            {wild && <span className="wild">{t('battle.wild')}</span>}
            {out && <span className="fnt">{t('battle.fainted')}</span>}
            <span className="num">{Math.round(shown)}<small>/{max}</small></span>
          </div>
        </div>
        {hit && <i className="flash" />}
      </div>
    </div>
  );
};

/** Cortinilla: franjas diagonales que tapan la pantalla y se retiran (el cambio de escena va debajo). */
const Wipe: React.FC<{ n: number }> = ({ n }) => {
  if (!n) return null;
  return (
    <div className="pg-bt-wipe" key={n} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ ['--i' as string]: i }} />)}
      <span className="ball" />
    </div>
  );
};

/** Cartel VS a pantalla completa: los dos combatientes enfrentados en diagonal con nombre, nivel y tipo. */
const VsSplash: React.FC<{ b: BattleState; pPic: string; fPic: string }> = ({ b, pPic, fPic }) => {
  const p = b.playerSpecies!, f = b.foeSpecies!;
  const vars = { ['--vsAt' as string]: `${INTRO.vsAt}s`, ['--vsSlam' as string]: `${INTRO.vsSlam}s`, ['--vsEnd' as string]: `${INTRO.vsEnd}s`, ['--bAt' as string]: `${INTRO.ballEnd - 0.05}s`, ['--bDur' as string]: `${INTRO.end - INTRO.ballEnd + 0.1}s` };
  const half = (side: 'p' | 'f', name: string, level: number, type: string, pic: string, tag: string) => (
    <div className={`half ${side}`} style={tcVar(type)}>
      <div className="lines" />
      <div className="mon">{pic && <img src={pic} alt="" />}</div>
      <div className="card">
        <small>{tag}</small>
        <b>{name}</b>
        <div className="meta"><span className="lv">{t('battle.lv', { n: level })}</span><span className="ty">{type}</span></div>
      </div>
    </div>
  );
  return (
    <div className="pg-bt-vs" style={vars} aria-hidden>
      {half('p', p.name, b.pLevel, p.type, pPic, t('battle.vsYou'))}
      {half('f', f.name, b.fLevel, f.type, fPic, t('battle.vsFoe'))}
      <div className="slash" />
      <div className="emblem"><span>{t('battle.vs')}</span></div>
      <div className="burst">{t('battle.fight')}</div>
    </div>
  );
};

/** Confeti de la victoria: piezas fijas con variación pseudoaleatoria por índice (solo transform/opacity). */
const CONF_COLORS = ['#ffd84a', '#4c9bff', '#ff5c7a', '#8cff6a', '#c58cff', '#ffffff'];
const Confetti: React.FC = () => {
  const bits = useMemo(() => Array.from({ length: 46 }, (_, i) => {
    const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    return { x: r(1) * 100, d: r(2) * 1.4, s: (r(3) - 0.5) * 160, rot: 360 + r(4) * 720, c: CONF_COLORS[i % CONF_COLORS.length], w: 7 + r(5) * 7, dur: 2.2 + r(6) * 1.4 };
  }), []);
  return (
    <div className="pg-bt-confetti" aria-hidden>
      {bits.map((q, i) => (
        <i key={i} style={{ left: `${q.x}%`, width: q.w, background: q.c, animationDelay: `${0.7 + q.d}s`, animationDuration: `${q.dur}s`, ['--s' as string]: `${q.s}px`, ['--r' as string]: `${q.rot}deg` }} />
      ))}
    </div>
  );
};

/** Pantalla final: cartel, estrellas según la vida que te queda, resumen fila a fila y recompensas. */
const Result: React.FC<{ b: BattleState; pic: string }> = ({ b, pic }) => {
  const win = b.result === 'win';
  const r = b.recap;
  const left = b.pMax > 0 ? b.pHp / b.pMax : 0;
  const stars = win ? (left > 0.6 ? 3 : left > 0.25 ? 2 : 1) : 0;
  const rows: [string, number][] = [
    [t('battle.rTurns'), r.turns],
    [t('battle.rDealt'), r.dealt],
    [t('battle.rBest'), r.best],
    [t('battle.rSupers'), r.supers],
    [t('battle.rCrits'), r.crits],
    [t('battle.rTaken'), r.taken],
  ];
  const ROW0 = 1.15, STEP = 0.11, STAR0 = ROW0 + rows.length * STEP + 0.15;
  useEffect(() => {
    const ts = rows.map((_, i) => setTimeout(() => bsfx.tick(i), (ROW0 + i * STEP) * 1000));
    for (let i = 0; i < stars; i++) ts.push(setTimeout(() => bsfx.star(i), (STAR0 + i * 0.22) * 1000));
    return () => ts.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {win && <Confetti />}
      <div className={`pg-bt-result ${win ? 'win' : 'lose'}`}>
        <div className="head">
          <b>{t(win ? 'battle.victory' : 'battle.defeat')}</b>
        </div>
        <div className="panel">
          <div className="who" style={tcVar(win ? b.playerSpecies!.type : b.foeSpecies!.type)}>
            <span className="pic">{pic && <img src={pic} alt="" />}</span>
            <div>
              <small>{win ? t('battle.winSub', { name: b.foeSpecies!.name }) : t('battle.loseSub', { name: b.playerSpecies!.name })}</small>
              {win && (
                <div className="stars">
                  {[0, 1, 2].map((i) => <i key={i} className={i < stars ? 'on' : ''} style={{ animationDelay: `${STAR0 + i * 0.22}s` }} />)}
                  <em style={{ animationDelay: `${STAR0 + 0.5}s` }}>{t(`battle.rate${stars}` as 'battle.rate1')}</em>
                </div>
              )}
            </div>
          </div>
          <h4>{t('battle.recap')}</h4>
          <div className="rows">
            {rows.map(([k, v], i) => <RecapRow key={k} label={k} value={v} delay={ROW0 + i * STEP} hot={(i === 3 || i === 4) && v > 0} />)}
          </div>
          {win ? (
            <>
              <h4>{t('battle.rewards')}</h4>
              <div className="rw" style={{ animationDelay: `${STAR0 + 0.7}s` }}>
                <span className="chip gold">★ {t('battle.rwWin')}</span>
                <span className="chip">{t('battle.rwMission')} ↑</span>
              </div>
            </>
          ) : <p className="tip" style={{ animationDelay: `${STAR0}s` }}>{t('battle.loseTip')}</p>}
          <button className="pg-bt-go" onClick={() => endBattle()} style={{ animationDelay: `${STAR0 + 0.4}s` }}>
            {t(win ? 'battle.continue' : 'battle.retreat')} <kbd>Enter</kbd>
          </button>
        </div>
      </div>
    </>
  );
};
const RecapRow: React.FC<{ label: string; value: number; delay: number; hot: boolean }> = ({ label, value, delay, hot }) => {
  const [go, setGo] = useState(false);
  useEffect(() => { const tm = setTimeout(() => setGo(true), delay * 1000); return () => clearTimeout(tm); }, [delay]);
  const v = useTween(go ? value : 0, 500);
  return (
    <div className={`row${hot ? ' hot' : ''}`} style={{ animationDelay: `${delay}s` }}>
      <span>{label}</span><b>{Math.round(v)}</b>
    </div>
  );
};

export const BattleScreen: React.FC = () => {
  const b = useBattle();
  useT();
  useCapture(); // la vida del salvaje vive en captureStore: refrescar cuando cambie
  const [pPic, setPPic] = useState('');
  const [fPic, setFPic] = useState('');
  const [hover, setHover] = useState(-1);
  const pModel = b.active ? b.pModel : '';
  const fModel = b.active ? b.fModel : '';

  useEffect(() => {
    let alive = true;
    setPPic('');
    if (pModel) portrait(pModel, b.pLook).then((u) => alive && setPPic(u)).catch(() => {});
    return () => { alive = false; };
  }, [pModel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setFPic('');
    if (fModel) portrait(fModel, b.fLook).then((u) => alive && setFPic(u)).catch(() => {});
    return () => { alive = false; };
  }, [fModel]); // eslint-disable-line react-hooks/exhaustive-deps

  useBattleAudio(b);

  const hints = useMemo(() => (b.foeSpecies ? b.moves.map((m) => effectiveness(m.type, b.foeSpecies!.type)) : []), [b.moves, b.foeSpecies]);
  const est = useMemo(() => b.moves.map((m, i) => estimate(m, hints[i] ?? 1, b.pStats, b.fStats)), [b.moves, hints, b.pStats, b.fStats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getBattle();
      if (!s.active || s.view !== 'arena' || s.closing) return;
      if (e.code === 'KeyM') { setMuted(!isMuted()); return; }
      if (s.turn === 'over') {
        if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); endBattle(); }
        return;
      }
      if (s.turn !== 'choose') return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') pick(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') pick(1);
      else if (e.code === 'KeyB') { fleeBattle(); endBattle(); }
      else if (e.code === 'Escape') { fleeBattle(); endBattle({ leaveEncounter: true }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const canAct = b.turn === 'choose' && !b.closing;
  useEffect(() => { if (!canAct) setHover(-1); }, [canAct]);

  const inStage = b.active && b.view === 'arena' && b.playerSpecies && b.foeSpecies;
  const p = b.playerSpecies, f = b.foeSpecies;
  const a = b.anim;
  const landed = !!a && a.phase === 'impact' && a.dmg > 0 && a.eff !== 0;
  const plateHit = (side: 'player' | 'foe') => (landed && a!.by !== side ? { id: a!.id, big: a!.crit || a!.eff >= 2 || a!.ko } : null);
  const over = b.turn === 'over' && b.result !== 'flee';
  const foeHp = getFoeHp();

  return (
    <>
      <Wipe n={b.wipe} />
      {inStage && p && f && (
        <div className={`pg-bt${b.closing ? ' closing' : ''}${b.turn === 'intro' ? ' intro' : ''}`} style={{ ['--plIn' as string]: `${INTRO.vsEnd + 0.1}s` }}>
          <div className="pg-bt-top">
            <Plate side="player" name={p.name} level={b.pLevel} type={p.type} hp={b.pHp} max={b.pMax} pic={pPic} hit={plateHit('player')} out={b.result === 'lose'} />
            <div className="pg-bt-mid"><span>{t('battle.vs')}</span></div>
            <Plate side="foe" name={f.name} level={b.fLevel} type={f.type} hp={foeHp} max={getFoeMax()} pic={fPic} wild hit={plateHit('foe')}
              preview={hover >= 0 ? Math.min(foeHp, est[hover]?.max ?? 0) : 0} out={b.result === 'win'} />
          </div>
          <MuteButton />

          {a && (
            <div key={`c${a.id}`} className={`pg-bt-call ${a.by}`} style={tcVar(a.type)}>
              <span className="pic">{(a.by === 'player' ? pPic : fPic) && <img src={a.by === 'player' ? pPic : fPic} alt="" />}</span>
              <span className="txt"><small>{a.type}</small><b>{a.name}</b></span>
            </div>
          )}
          {landed && <div key={`e${a!.id}`} className={`pg-bt-edge${a!.crit || a!.eff >= 2 ? ' big' : ''}`} style={tcVar(a!.type)} />}
          {landed && !a!.ko && (a!.crit || a!.eff >= 2) && (
            <div key={`b${a!.id}`} className={`pg-bt-big ${a!.crit ? 'crit' : 'super'} ${a!.by}`} style={tcVar(a!.type)}>
              <i className="slash" />
              <b>{t(a!.crit ? 'battle.critBig' : 'battle.superBig')}</b>
              {a!.crit && a!.eff >= 2 && <small>{t('battle.superBig')}</small>}
            </div>
          )}
          {a && a.phase === 'impact' && a.ko && (
            <div key={`k${a.id}`} className="pg-bt-ko">
              <i className="bar t" /><i className="bar b" />
              <div className="flash" />
              <b>K.O.</b>
            </div>
          )}

          {b.turn === 'intro' && <VsSplash b={b} pPic={pPic} fPic={fPic} />}

          {over && <Result b={b} pic={b.result === 'win' ? pPic : fPic} />}

          {b.turn !== 'intro' && !over && (
            <div className="pg-bt-bottom">
              <div className="pg-bt-log" key={b.log}>{b.log}</div>
              {b.turn === 'over' ? (
                <button className="pg-bt-go" onClick={() => endBattle()}>
                  {t('battle.toBall')} <kbd>Enter</kbd>
                </button>
              ) : (
                <div className={`pg-bt-bar${canAct ? '' : ' wait'}`}>
                  {b.moves.map((m, i) => {
                    const eff = hints[i] ?? 1;
                    const tag = eff === 0 ? t('battle.tagNone') : eff >= 2 ? t('battle.tagSuper') : eff <= 0.5 ? t('battle.tagWeak') : '';
                    const e = est[i];
                    const pctFoe = getFoeMax() > 0 ? Math.round((100 * e.max) / getFoeMax()) : 0;
                    return (
                      <button key={m.name} className={`pg-bt-move${eff >= 2 ? ' sup' : ''}`} style={{ ...tcVar(m.type), ['--i' as string]: i }} disabled={!canAct}
                        onClick={() => pick(i)} onMouseEnter={() => canAct && setHover(i)} onMouseLeave={() => setHover(-1)} onFocus={() => canAct && setHover(i)} onBlur={() => setHover(-1)}>
                        <span className="gem"><kbd>{i + 1}</kbd></span>
                        <span className="main">
                          <span className="nm">{m.name}</span>
                          <span className="meta">
                            <span className="ty">{m.type}</span>
                            <span className="pw">{t('battle.power', { n: m.power })}</span>
                            {tag && <span className={`eff e${eff >= 2 ? 'up' : eff === 0 ? 'no' : 'dn'}`}>{tag}</span>}
                          </span>
                        </span>
                        <span className="tip">
                          <b>{t('battle.estDmg', { min: e.min, max: e.max })}</b>
                          <small>{e.max >= foeHp && foeHp > 0 ? t('battle.previewKo') : t('battle.estPct', { pct: pctFoe })}</small>
                        </span>
                      </button>
                    );
                  })}
                  <div className="pg-bt-side">
                    <button className="pg-bt-mini" disabled={!canAct} onClick={() => { fleeBattle(); endBattle(); }} title={t('battle.ballTitle')}>
                      <span className="pg-bt-ballic" /> {t('battle.ball')}
                    </button>
                    <button className="pg-bt-mini ghost" disabled={!canAct} onClick={() => { fleeBattle(); endBattle({ leaveEncounter: true }); }} title={t('battle.fleeTitle')}>
                      {t('battle.flee')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
