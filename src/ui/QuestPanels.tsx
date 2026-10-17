import React, { useEffect, useState } from 'react';
import type { EggInfo, EggKind, Mission, MissionReward } from '../../lib/api';
import { BALLS, type BallKey } from '../world/species';
import { useQuests, claimMission, incubate, hatch, closeHatch, loadMissions, loadEggs } from '../world/questStore';
import { showCard } from '../world/captureStore';
import { portrait } from '../world/portrait';
import { useOnline } from '../world/online';
import { t, tk, useT, type Key } from '../i18n';
import { rich } from '../i18n/rich';
import './polish/panels.css';

const EGG_KEY: Record<EggKind, Key> = { green: 'egg.green', blue: 'egg.blue', gold: 'egg.gold' };
/** Texto de la misión en el idioma actual, armado desde su tipo (el servidor manda solo el inglés). */
const missionText = (m: Mission) => {
  if (m.k === 'walk') return t('mission.walk', { n: m.goal / 1000 });
  if (m.k === 'rare' && m.goal === 1) return t('mission.rare1');
  return tk(`mission.${m.k}`, m.text, { n: m.goal, type: m.arg ?? '' });
};

const hms = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const fmtP = (m: Mission) => (m.unit === 'm' ? `${(m.p / 1000).toFixed(2)} / ${m.goal / 1000} km` : `${m.p} / ${m.goal}`);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const Reward: React.FC<{ r: MissionReward }> = ({ r }) => (
  <span className="pg-mis-rw">
    {Object.entries(r.balls).map(([k, v]) => (
      <span key={k}><i className="pg-ball-ic" style={{ background: `linear-gradient(180deg, ${hex(BALLS[k as BallKey].color)} 0 47%, #1a2330 47% 53%, #f4f6fb 53%)` }} />×{v}</span>
    ))}
    <span className="pts">{t('reward.pts', { n: r.points })}</span>
  </span>
);

const MissionRow: React.FC<{ m: Mission; kind: 'd' | 'w'; r: MissionReward; i: number }> = ({ m, kind, r, i }) => {
  const done = m.p >= m.goal;
  const [busy, setBusy] = useState(false);
  return (
    <div className={`pg-mis ${done ? 'done' : ''} ${m.claimed ? 'claimed' : ''}`} style={{ '--i': i } as React.CSSProperties}>
      <div className="t"><b>{missionText(m)}</b><span>{fmtP(m)}</span></div>
      <div className="bar"><i style={{ width: `${Math.min(100, (m.p / m.goal) * 100)}%` }} /></div>
      <div className="f">
        <Reward r={r} />
        {m.claimed ? <span className="ok">{t('missions.collected')}</span>
          : done ? <button className="pg-btn small" disabled={busy} onClick={async () => { setBusy(true); await claimMission(kind, m.i); setBusy(false); }}>{t('missions.collect')}</button>
            : null}
      </div>
    </div>
  );
};

export const MissionsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { missions } = useQuests();
  const online = useOnline();
  useT();
  useEffect(() => { void loadMissions(); }, [online.status]);
  return (
    <div className="pg-drawer pg-win pg-pn k-missions">
      <h3>{t('nav.missions')} <button className="x" onClick={onClose}>✕</button></h3>
      {online.status !== 'online' ? (
        <p className="pg-empty">{t('missions.offline')}</p>
      ) : !missions ? (
        <p className="pg-empty">{t('missions.loading')}</p>
      ) : (
        <>
          <p className="pg-mis-help">{rich(t('missions.help'))}</p>
          <div className="pg-mis-two">
            <section>
              <header><h4>{t('missions.daily')}</h4><span className="timer">{t('missions.newIn', { t: hms(missions.resetD) })}</span></header>
              {missions.d.map((m, i) => <MissionRow key={`d${m.i}`} m={m} kind="d" r={missions.reward.daily} i={i} />)}
              <div className={`pg-mis-bonus ${missions.bonusD ? 'got' : ''}`}><EggShape kind="green" size={26} /> {t('missions.allThree')} <b>{t('egg.green')}</b>{missions.bonusD ? t('missions.collectedTag') : ''}</div>
            </section>
            <section>
              <header><h4>{t('missions.weekly')}</h4><span className="timer">{t('missions.newIn', { t: hms(missions.resetW) })}</span></header>
              {missions.w.map((m, i) => <MissionRow key={`w${m.i}`} m={m} kind="w" r={missions.reward.weekly} i={i + 1} />)}
              <div className={`pg-mis-bonus ${missions.bonusW ? 'got' : ''}`}><EggShape kind="blue" size={26} /> {t('missions.allThree')} <b>{t('egg.blue')}</b>{missions.bonusW ? t('missions.collectedTag') : ''}</div>
            </section>
          </div>
        </>
      )}
    </div>
  );
};

/** Huevo dibujado en CSS, con las manchas del color de su clase. */
export const EggShape: React.FC<{ kind: EggKind; size?: number; wobble?: boolean }> = ({ kind, size = 72, wobble }) => (
  <span className={`pg-egg k-${kind}${wobble ? ' wobble' : ''}`} style={{ width: size * 0.78, height: size }} />
);

const EggCard: React.FC<{ e: EggInfo; canIncubate: boolean }> = ({ e, canIncubate }) => {
  const [busy, setBusy] = useState(false);
  const ready = e.start != null && e.progress >= 1;
  const act = async (fn: () => Promise<void>) => { setBusy(true); await fn(); setBusy(false); };
  return (
    <div className={`pg-egg-card ${ready ? 'ready' : ''}`}>
      <EggShape kind={e.kind} wobble={ready} />
      <b>{t(EGG_KEY[e.kind])}</b>
      {e.start != null ? (
        <>
          <div className="bar"><i style={{ width: `${Math.round(e.progress * 100)}%` }} /></div>
          <small>{ready ? t('eggs.ready') : t('eggs.toGo', { km: (e.left / 1000).toFixed(2) })}</small>
          {ready && <button className="pg-btn small gold" disabled={busy} onClick={() => act(() => hatch(e.id))}>{t('eggs.hatch')}</button>}
        </>
      ) : (
        <>
          <small>{t('eggs.kmToHatch', { km: e.km })}</small>
          <button className="pg-btn small" disabled={busy || !canIncubate} onClick={() => act(() => incubate(e.id))}>{t('eggs.incubate')}</button>
        </>
      )}
    </div>
  );
};

/** La sección de huevos de la Caja: incubadoras arriba, la bolsa de huevos debajo. */
export const EggsSection: React.FC = () => {
  const { eggs } = useQuests();
  const online = useOnline();
  useT();
  useEffect(() => { void loadEggs(); }, [online.status]);
  if (online.status !== 'online' || !eggs) return null;
  const inc = eggs.eggs.filter((e) => e.start != null), bag = eggs.eggs.filter((e) => e.start == null);
  const slots = Array.from({ length: eggs.incubators }, (_, i) => inc[i] ?? null);
  return (
    <section className="pg-eggs">
      <header><h4>{t('eggs.title')}</h4><span className="timer">{t('eggs.walked', { km: (eggs.walked / 1000).toFixed(2) })}</span></header>
      <p className="pg-mis-help">{t('eggs.help')}</p>
      <div className="pg-egg-row">
        {slots.map((e, i) => (e ? <EggCard key={e.id} e={e} canIncubate={false} /> : (
          <div className="pg-egg-card slot" key={`slot${i}`}><span className="ring" /><b>{t('eggs.incubator')}</b><small>{t('eggs.free')}</small></div>
        )))}
        {bag.map((e) => <EggCard key={e.id} e={e} canIncubate={inc.length < eggs.incubators} />)}
      </div>
      {!bag.length && !inc.length && <p className="pg-empty">{t('eggs.empty')}</p>}
    </section>
  );
};

/** La eclosión: el huevo tiembla cada vez más, destella y aparece el monstruo. */
export const HatchModal: React.FC = () => {
  const { hatching } = useQuests();
  useT();
  const [phase, setPhase] = useState<'shake' | 'out'>('shake');
  const [pic, setPic] = useState('');
  useEffect(() => {
    if (!hatching) return;
    setPhase('shake'); setPic('');
    if (hatching.mon) portrait(hatching.mon.model).then(setPic).catch(() => {});
    const t = setTimeout(() => setPhase('out'), 2800);
    return () => clearTimeout(t);
  }, [hatching]);
  if (!hatching) return null;
  const mon = hatching.mon;
  return (
    <div className="pg-overlay pg-hatch" onClick={phase === 'out' ? closeHatch : undefined}>
      <div className={`pg-hatch-box k-${hatching.kind} ${phase}`} onClick={(e) => e.stopPropagation()}>
        {phase === 'shake' ? (
          <>
            <EggShape kind={hatching.kind} size={170} wobble />
            <p>{t('hatch.moving', { egg: t(EGG_KEY[hatching.kind]) })}</p>
          </>
        ) : (
          <>
            <span className="burst" />
            <div className="pic">{pic ? <img src={pic} alt="" /> : <EggShape kind={hatching.kind} size={120} />}</div>
            <h2>{mon?.shiny ? '✨ ' : ''}{mon?.name ?? t('hatch.aMonster')}</h2>
            <p>{t('hatch.from', { egg: t(EGG_KEY[hatching.kind]) })}{mon?.shiny ? t('hatch.shiny') : ''} <b>{t('hatch.points', { n: hatching.points })}</b></p>
            {mon && <span className={`pg-rar t-${mon.tier}`}>{mon.tier}</span>}
            <div className="btns">
              {mon && <button className="pg-btn small ghost" onClick={() => { closeHatch(); showCard(mon.id); }}>{t('hatch.seeCard')}</button>}
              <button className="pg-btn" onClick={closeHatch}>{t('hatch.great')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
