// Combates de equipo, como la pestaña Battle del original: los 8 Gimnasios (líderes = los tokens más grandes de
// Arc, medalla al ganar), la Arena (rating contra los equipos de otros entrenadores), tu Equipo de 3 y el horario de
// legendarios de Legend Summit. El servidor resuelve cada turno (features.ts / duel.ts); aquí se reproducen los golpes.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ArenaResult, type DuelEnd, type DuelEvent, type DuelUnit, type DuelView, type GymsResult, type LegendsResult } from '../../lib/featuresApi';
import { getCollection, monLevel, monSpecies, type CaughtMon } from '../world/captureStore';
import { TYPE_COLORS, type MonType } from '../world/species';
import { refreshMe, useOnline } from '../world/online';
import { portrait } from '../world/portrait';
import { sfx } from '../audio/sound';
import { t, useT } from '../i18n';
import './features.css';
import './parity.css';

type Tab = 'gyms' | 'arena' | 'team' | 'legends';
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const tc = (type: string) => TYPE_COLORS[type as MonType] ?? '#888';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const balls = (b: Partial<Record<string, number>> | null | undefined) =>
  Object.entries(b ?? {}).filter(([, n]) => n).map(([k, n]) => `${n} ${t(`bt.ball.${k}` as 'bt.ball.ball')}`).join(' · ');
const TIER_BONUS: Record<string, number> = { Common: 0, Uncommon: 2, Rare: 5, Epic: 8, Legendary: 12 };
/** Misma fórmula que battleLevel() del servidor: nivel del token (suelo 8) + rareza + etapa + shiny. */
export const battleLevel = (m: CaughtMon) => Math.min(100, Math.max(8, monLevel(m)) + (TIER_BONUS[m.tier] ?? 0) + (m.stage - 1) * 2 + (m.shiny ? 2 : 0));

const Pic: React.FC<{ model: string; logo?: string | null; symbol?: string | null; shiny?: boolean; size?: number }> = ({ model, logo, symbol, shiny, size = 64 }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    portrait(model, { logo: logo ?? undefined, symbol: symbol ?? undefined, shiny }).then((u) => alive && setSrc(u)).catch(() => {});
    return () => { alive = false; };
  }, [model, logo, symbol, shiny]);
  return <span className="pg-p-pic" style={{ width: size, height: size }}>{src ? <img src={src} alt="" /> : <i className="spin" />}</span>;
};

export const BattlePanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useT();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('gyms');
  const [duel, setDuel] = useState<DuelView | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (online.status === 'online') api.duel().then((r) => setDuel(r.duel)).catch(() => {}); }, [online.status]);

  const start = async (fn: () => Promise<DuelView>) => {
    setBusy(true); setMsg(null);
    try { setDuel(await fn()); } catch (e) { setMsg({ ok: false, text: err(e) }); } finally { setBusy(false); }
  };

  if (online.status !== 'online') {
    return (
      <div className="pg-drawer pg-win k-battle">
        <h3>{t('nav.battle')} <button className="x" onClick={onClose}>✕</button></h3>
        <p className="pg-empty">{t('bt.needsServer')}</p>
      </div>
    );
  }
  return (
    <div className="pg-drawer pg-win k-battle">
      <h3>{t('nav.battle')} <button className="x" onClick={onClose}>✕</button></h3>
      {duel ? (
        <DuelScreen duel={duel} onDone={(text) => { setDuel(null); if (text) setMsg({ ok: true, text }); void refreshMe(); }} />
      ) : (
        <>
          <div className="pg-f-tabs">
            {(['gyms', 'arena', 'team', 'legends'] as Tab[]).map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(null); }}>{t(`bt.tab.${k}` as 'bt.tab.gyms')}</button>
            ))}
          </div>
          {msg && <div className={msg.ok ? 'pg-f-ok' : 'pg-f-err'}>{msg.text}</div>}
          {tab === 'gyms' && <GymsTab busy={busy} onStart={(n) => start(() => api.gymStart(n))} />}
          {tab === 'arena' && <ArenaTab busy={busy} onStart={(id) => start(() => api.arenaStart(id))} />}
          {tab === 'team' && <TeamTab />}
          {tab === 'legends' && <LegendsTab />}
        </>
      )}
    </div>
  );
};

const GymsTab: React.FC<{ busy: boolean; onStart: (n: number) => void }> = ({ busy, onStart }) => {
  useT();
  const [g, setG] = useState<GymsResult | null>(null);
  const [e, setE] = useState<string | null>(null);
  useEffect(() => { api.gyms().then(setG, (x) => setE(err(x))); }, []);
  if (e) return <div className="pg-f-err">{e}</div>;
  if (!g) return <p className="pg-empty">{t('common.loading')}</p>;
  return (
    <>
      <p className="pg-mart-note">{t('bt.gymsNote', { n: g.badges.length })}</p>
      <div className="pg-p-badges">{Array.from({ length: 8 }, (_, i) => <span key={i} className={g.badges.includes(i + 1) ? 'on' : ''}>{i + 1}</span>)}</div>
      <TeamStrip team={g.team} />
      <div className="pg-p-gyms">
        {g.gyms.map((gym) => (
          <div key={gym.n} className={`pg-p-gym${gym.beaten ? ' won' : ''}${gym.locked ? ' locked' : ''}`} style={{ ['--tc' as string]: tc(gym.type) }}>
            <div className="hd">
              <span className="no">{gym.n}</span>
              {gym.logo ? <img className="logo" src={gym.logo} alt="" /> : <span className="logo ph">{gym.type[0]}</span>}
              <div className="grow"><b>{gym.leader}</b><small>{gym.type} · Lv {gym.team.map((m) => m.level).join('/')}</small></div>
              {gym.beaten && <span className="pg-f-tag paid">{t('bt.badge')}</span>}
            </div>
            <div className="mons">{gym.team.map((m, k) => <Pic key={k} model={m.model} logo={k === 2 ? gym.logo : null} symbol={k === 2 ? gym.symbol : null} size={44} />)}</div>
            <small className="rw">{gym.beaten ? t('bt.rematchReward', { r: balls(g.rematch.balls), p: g.rematch.points }) : t('bt.firstReward', { r: balls(gym.reward.balls), p: gym.reward.points })}</small>
            <button className="pg-btn small" disabled={busy || gym.locked || (gym.beaten && gym.rematchToday)} onClick={() => onStart(gym.n)}>
              {gym.locked ? t('bt.locked', { n: gym.n - 1 }) : gym.beaten ? (gym.rematchToday ? t('bt.doneToday') : t('bt.rematch')) : t('bt.challenge')}
            </button>
          </div>
        ))}
      </div>
    </>
  );
};

const TeamStrip: React.FC<{ team: (DuelUnit & { stage?: number })[] }> = ({ team }) => (
  <div className="pg-p-strip">
    <small>{t('bt.yourTeam')}</small>
    {team.length ? team.map((u) => (
      <span key={u.id} className="m" style={{ ['--tc' as string]: tc(u.type) }}><Pic model={u.model} logo={u.logo} symbol={u.symbol} shiny={u.shiny} size={34} /><b>{u.name}</b><em>Lv {u.level}</em></span>
    )) : <em>{t('bt.noTeam')}</em>}
  </div>
);

const ArenaTab: React.FC<{ busy: boolean; onStart: (id: string) => void }> = ({ busy, onStart }) => {
  useT();
  const [a, setA] = useState<ArenaResult | null>(null);
  const [e, setE] = useState<string | null>(null);
  useEffect(() => { api.arena().then(setA, (x) => setE(err(x))); }, []);
  if (e) return <div className="pg-f-err">{e}</div>;
  if (!a) return <p className="pg-empty">{t('common.loading')}</p>;
  return (
    <>
      <div className="pg-f-stats">
        <div className="pg-f-stat"><small>{t('bt.rating')}</small><b>{a.elo}</b></div>
        <div className="pg-f-stat"><small>{t('bt.rank')}</small><b>#{a.rank}</b></div>
        <div className="pg-f-stat"><small>{t('bt.left')}</small><b>{a.left}/{a.daily}</b></div>
      </div>
      <p className="pg-mart-note">{t('bt.arenaNote')}</p>
      <h4 className="pg-sub">{t('bt.opponents')}</h4>
      {!a.opponents.length && <p className="pg-empty">{t('bt.noOpponents')}</p>}
      <div className="pg-f-list">
        {a.opponents.map((o) => (
          <div className="pg-f-item" key={o.id}>
            <div className="grow"><b>{o.name}{o.wallet ? ' 🔗' : ''}</b><span>{t('bt.oppLine', { elo: o.elo, b: o.badges })}{o.beatenToday ? ` · ${t('bt.beatenToday')}` : ''}</span></div>
            <button className="pg-btn" disabled={busy || a.left <= 0} onClick={() => onStart(o.id)}>{t('bt.fight')}</button>
          </div>
        ))}
      </div>
      <h4 className="pg-sub">{t('bt.topArena')}</h4>
      <div className="pg-list">
        {a.top.map((r) => (
          <div className="pg-row pg-lb" key={r.rank}><span className="no">{r.rank}</span><span className="nm">{r.name}{r.wallet ? ' 🔗' : ''}</span><b className="pg-lb-pts">{r.elo}</b></div>
        ))}
      </div>
    </>
  );
};

const TeamTab: React.FC = () => {
  useT();
  const { trainer } = useOnline();
  const mine = [...getCollection()].sort((a, b) => battleLevel(b) - battleLevel(a));
  const [sel, setSel] = useState<string[]>(() => ((trainer as { team?: string[] } | null)?.team ?? []).filter((id) => mine.some((m) => m.id === id)));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]));
  const save = async () => {
    try { await api.teamSet(sel); setMsg({ ok: true, text: t('bt.teamSaved') }); void refreshMe(); } catch (e) { setMsg({ ok: false, text: err(e) }); }
  };
  return (
    <>
      <p className="pg-mart-note">{t('bt.teamNote')}</p>
      {msg && <div className={msg.ok ? 'pg-f-ok' : 'pg-f-err'}>{msg.text}</div>}
      {!mine.length && <p className="pg-empty">{t('bt.boxEmpty')}</p>}
      <div className="pg-f-mons">
        {mine.map((m) => {
          const sp = monSpecies(m);
          const i = sel.indexOf(m.id);
          return (
            <button key={m.id} className={`pg-f-mon ${i >= 0 ? 'on' : ''}`} onClick={() => toggle(m.id)} style={{ ['--tc' as string]: tc(sp?.type ?? 'Normal') }}>
              {i >= 0 ? `${i + 1}. ` : ''}{m.shiny ? '✨ ' : ''}{m.name}
              <small>{sp?.type} · {m.tier} · Lv {battleLevel(m)}</small>
            </button>
          );
        })}
      </div>
      <div className="pg-f-actions">
        <button className="pg-btn" onClick={save}>{t('bt.saveTeam', { n: sel.length })}</button>
        {sel.length > 0 && <button className="pg-btn ghost" onClick={() => setSel([])}>{t('bt.auto')}</button>}
      </div>
    </>
  );
};

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const LegendsTab: React.FC = () => {
  useT();
  const [l, setL] = useState<LegendsResult | null>(null);
  const [e, setE] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { api.legends().then(setL, (x) => setE(err(x))); const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  if (e) return <div className="pg-f-err">{e}</div>;
  if (!l) return <p className="pg-empty">{t('common.loading')}</p>;
  const cur = l.schedule.find((s) => s.start <= now && now < s.end);
  return (
    <>
      <p className="pg-mart-note">{t('bt.legendsNote', { bounty: l.bounty, symbol: l.symbol })}</p>
      <div className={l.access ? 'pg-f-ok' : 'pg-f-err'}>{t(l.access ? (l.holder ? 'bt.accessHolder' : 'bt.accessPass') : 'bt.noAccess')}</div>
      {cur && <div className="pg-p-live">{t(l.caughtThis === cur.id ? 'bt.legendCaught' : 'bt.legendLive', { name: cur.name, m: Math.ceil((cur.end - now) / 60000) })}</div>}
      <h4 className="pg-sub">{t('bt.schedule')}</h4>
      <div className="pg-list">
        {l.schedule.map((s) => (
          <div className={`pg-row pg-lb${s === cur ? ' me' : ''}`} key={s.id}>
            <span className="no">{hhmm(s.start)}</span><span className="nm">{s.name}</span>
            <span className="pg-lb-sub">{new Date(s.start).toLocaleDateString([], { weekday: 'short' })} · 30 min</span>
          </div>
        ))}
      </div>
      <h4 className="pg-sub">{t('bt.hallOfFame')}</h4>
      {!l.hallOfFame.length ? <p className="pg-empty">{t('bt.noFame')}</p> : (
        <div className="pg-list">
          {l.hallOfFame.map((f, i) => (
            <div className="pg-row pg-lb" key={i}><span className="no">{new Date(f.at).toLocaleDateString()}</span><span className="nm">{f.name}</span><span className="pg-lb-sub">{t(f.paid ? 'league.paid' : 'league.pending')}</span></div>
          ))}
        </div>
      )}
    </>
  );
};

/** Pantalla del combate de equipo: los dos equipos arriba y abajo, el activo en grande, y los ataques. */
const DuelScreen: React.FC<{ duel: DuelView; onDone: (msg: string | null) => void }> = ({ duel, onDone }) => {
  useT();
  const [d, setD] = useState<DuelView>(duel);
  const [log, setLog] = useState(t('bt.duelStart', { foe: duel.foeName }));
  const [busy, setBusy] = useState(false);
  const [hit, setHit] = useState<{ side: 'foe' | 'player'; n: number } | null>(null);
  const [end, setEnd] = useState<DuelEnd | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const play = useCallback(async (events: DuelEvent[], final: DuelView) => {
    let cur: DuelView = JSON.parse(JSON.stringify(d));
    for (const [k, ev] of events.entries()) {
      if (!alive.current) return;
      const attacker = ev.side === 'foe' ? cur.p[cur.pi] : cur.f[cur.fi];
      const target = ev.side === 'foe' ? cur.f[cur.fi] : cur.p[cur.pi];
      sfx.cast(ev.type as MonType);
      setLog(t('bt.used', { who: attacker.name, move: ev.name }));
      await wait(550);
      target.hp = Math.max(0, target.hp - ev.dmg);
      if (ev.dmg > 0 && ev.eff !== 0) sfx.hit(ev.eff >= 2, ev.ko);
      setHit({ side: ev.side, n: k });
      setD({ ...cur, p: [...cur.p], f: [...cur.f] });
      setLog(`${t('bt.used', { who: attacker.name, move: ev.name })} ${ev.eff === 0 ? t('battle.effNone') : ev.eff >= 2 ? t('battle.effSuper') : ev.eff <= 0.5 ? t('battle.effWeak') : ''}`.trim());
      await wait(750);
      if (ev.ko) {
        setLog(t('bt.fainted', { name: target.name }));
        await wait(700);
        if (ev.next) {
          if (ev.side === 'foe') cur = { ...cur, fi: final.fi }; else cur = { ...cur, pi: final.pi };
          setD(cur);
          setLog(t('bt.sendsOut', { name: ev.next }));
          await wait(700);
        }
      }
    }
    setHit(null);
    setD(final);
  }, [d]);

  const move = async (i: number) => {
    if (busy || d.over) return;
    setBusy(true); sfx.ui();
    try {
      const r = await api.duelMove(i);
      await play(r.events, r.duel);
      if (r.end) setEnd(r.end);
      else setLog(t('bt.whatWill', { name: r.duel.p[r.duel.pi].name }));
    } catch (e) { setLog(err(e)); } finally { setBusy(false); }
  };
  const giveUp = async () => {
    setBusy(true);
    try { const r = await api.duelLeave(); onDone(r.end?.delta ? t('bt.gaveUpElo', { d: r.end.delta }) : t('bt.gaveUp')); } catch (e) { setLog(err(e)); setBusy(false); }
  };
  const summary = (e: DuelEnd) => {
    if (e.result !== 'win') return t(d.kind === 'arena' ? 'bt.loseArena' : 'bt.loseGym', { d: e.delta ?? 0 });
    if (d.kind === 'gym') return e.badge ? t('bt.winBadge', { n: e.badge, r: balls(e.reward), p: e.points ?? 0 }) : e.reward ? t('bt.winRematch', { r: balls(e.reward), p: e.points ?? 0 }) : t('bt.winNoReward');
    return e.counted ? t('bt.winArena', { d: e.delta ?? 0, p: e.points ?? 0 }) : t('bt.winArenaRepeat');
  };

  const P = d.p[d.pi], F = d.f[d.fi];
  return (
    <div className="pg-p-duel">
      <div className="pg-p-side foe">
        <small>{d.kind === 'gym' ? t('bt.gymLeader', { n: d.ref }) : t('bt.arenaFoe')} · <b>{d.foeName}</b></small>
        <div className="team">{d.f.map((u, k) => <span key={u.id} className={`dot${u.hp <= 0 ? ' out' : ''}${k === d.fi ? ' on' : ''}`} />)}</div>
      </div>
      <Fighter u={F} side="foe" hit={hit?.side === 'foe' ? hit.n : null} />
      <Fighter u={P} side="player" hit={hit?.side === 'player' ? hit.n : null} />
      <div className="pg-p-side">
        <small>{t('bt.yourTeam')}</small>
        <div className="team">{d.p.map((u, k) => <span key={u.id} className={`dot${u.hp <= 0 ? ' out' : ''}${k === d.pi ? ' on' : ''}`} />)}</div>
      </div>
      <div className="pg-p-log">{end ? summary(end) : log}</div>
      {end ? (
        <div className="pg-f-actions"><button className="pg-btn gold" onClick={() => onDone(summary(end))}>{t('battle.continue')}</button></div>
      ) : (
        <div className="pg-p-moves">
          {d.moves.map((m, i) => (
            <button key={m.name + i} className="pg-bx-move" style={{ ['--tc' as string]: tc(m.type) }} disabled={busy} onClick={() => move(i)}>
              <kbd>{i + 1}</kbd><span className="nm">{m.name}</span>
              <span className="meta"><span className="ty">{m.type}</span>{m.eff >= 2 && <span className="eff eup">{t('battle.tagSuper')}</span>}{m.eff > 0 && m.eff <= 0.5 && <span className="eff edn">{t('battle.tagWeak')}</span>}{m.eff === 0 && <span className="eff eno">{t('battle.tagNone')}</span>}</span>
            </button>
          ))}
          <button className="pg-btn ghost small" disabled={busy} onClick={giveUp}>{t('bt.giveUp')}</button>
        </div>
      )}
    </div>
  );
};

const Fighter: React.FC<{ u: DuelUnit; side: 'foe' | 'player'; hit: number | null }> = ({ u, side, hit }) => {
  const pct = u.max > 0 ? Math.max(0, (100 * u.hp) / u.max) : 0;
  return (
    <div className={`pg-p-fighter ${side}${hit !== null ? ' hit' : ''}${u.hp <= 0 ? ' ko' : ''}`} key={`${u.id}-${hit}`} style={{ ['--tc' as string]: tc(u.type) }}>
      <Pic model={u.model} logo={u.logo} symbol={u.symbol} shiny={u.shiny} size={96} />
      <div className="plate">
        <div className="row"><b>{u.shiny ? '✨ ' : ''}{u.name}</b><span>Lv{u.level}</span></div>
        <div className="hp"><i className={pct > 50 ? 'ok' : pct > 20 ? 'mid' : 'low'} style={{ width: `${pct}%` }} /></div>
        <div className="row sub"><span className="ty" style={{ background: tc(u.type) }}>{u.type}</span><span>{Math.round(u.hp)}/{u.max}</span></div>
      </div>
    </div>
  );
};
