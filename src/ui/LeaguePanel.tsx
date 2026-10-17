import React, { useEffect, useState } from 'react';
import type { BoardResult, BoardRow, FeedRow, MiniRow, PrizeCat } from '../../lib/api';
import { fetchBoard, refreshMe, rename, useOnline } from '../world/online';
import { fmtUsd } from '../world/tokenSpecies';
import { imgUrl } from '../world/tokenLook';
import { t as tr, tk, useT, type Key } from '../i18n';
import { txUrl } from '../../lib/arc/payConfig';
import { rich } from '../i18n/rich';
import './polish/panels.css';

type Tab = 'week' | 'arena' | 'disc' | 'all' | 'winners' | 'feed';

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const left = (t: number) => {
  const h = Math.max(0, Math.round((t - Date.now()) / 3600_000));
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
};

const FeedLine: React.FC<{ f: FeedRow; i: number }> = ({ f, i }) => {
  const tok = f.symbol ? `**$${f.symbol}**` : '';
  const shiny = f.shiny ? tr('league.shinyWord') : '';
  const text = rich(f.kind === 'evolve'
    ? tr('league.evolved', { tok, species: f.species ?? '', from: f.stage_from ?? '', to: f.stage_to ?? '' })
    : f.kind === 'discover'
      ? tr('league.discovered', { who: f.trainer_name ?? '', tok, shiny, species: f.species ?? '' })
      : tr('league.caught', { who: f.trainer_name ?? '', tok, shiny, species: f.species ?? '' }));
  return (
    <div className={`pg-feed-row k-${f.kind}`} style={{ '--i': i } as React.CSSProperties}>
      <span className="pg-feed-ic">{f.logo ? <img src={imgUrl(f.logo, 48)} alt="" /> : f.kind === 'evolve' ? '🧬' : f.kind === 'discover' ? '🌟' : '⚪'}</span>
      <span className="pg-feed-tx">{text}{f.mcap ? <small> · {fmtUsd(f.mcap)}</small> : null}</span>
      <span className="pg-feed-at">{ago(f.at)}</span>
    </div>
  );
};

const Medal: React.FC<{ rank: number }> = ({ rank }) => <span className={`no pg-rk r${Math.min(rank, 4)}`}>{rank}</span>;

/** Los tres primeros en escalones (2 · 1 · 3); el resto sigue debajo en la lista. */
function Podium<T extends MiniRow>({ rows, me, unit, sub }: { rows: T[]; me?: string; unit?: string; sub?: (r: T) => React.ReactNode }) {
  const top = rows.filter((r) => r.rank <= 3);
  if (!top.length) return null;
  const order = [top.find((r) => r.rank === 2), top.find((r) => r.rank === 1), top.find((r) => r.rank === 3)];
  return (
    <div className="pg-podium">
      {order.map((r, i) => r ? (
        <div className={`pg-pod p${r.rank} ${r.name === me ? 'me' : ''}`} key={`${r.rank}-${r.name}`} style={{ '--i': i } as React.CSSProperties}>
          <span className="av">{r.name.slice(0, 1).toUpperCase()}</span>
          <b className="nm">{r.name}{r.wallet ? ' 🔗' : ''}</b>
          <span className="pts">{r.points}{unit ? <small> {unit}</small> : null}</span>
          {sub && <small className="sub">{sub(r)}</small>}
          <span className="step">{r.rank}</span>
        </div>
      ) : <div className="pg-pod empty" key={`e${i}`} />)}
    </div>
  );
}

const Rows: React.FC<{ rows: BoardRow[]; me?: string }> = ({ rows, me }) => {
  const sub = (r: BoardRow) => <>{tr('league.rowSub', { c: r.catches, d: r.disc })}{r.shinies ? ` · ${r.shinies}✨` : ''}</>;
  return rows.length === 0 ? <p className="pg-empty">{tr('league.noScore')}</p> : (
    <>
      <Podium rows={rows} me={me} sub={sub} />
      <div className="pg-list">
        {rows.filter((r) => r.rank > 3).map((r, i) => (
          <div className={`pg-row pg-lb ${r.name === me ? 'me' : ''}`} key={`${r.rank}-${r.name}`} style={{ '--i': i } as React.CSSProperties}>
            <Medal rank={r.rank} />
            <span className="nm">{r.name}{r.wallet ? ' 🔗' : ''}{r.name === me && <em className="pg-me-tag">{tr('tok.you')}</em>}</span>
            <span className="pg-lb-sub">{sub(r)}</span>
            <b className="pg-lb-pts">{r.points}</b>
          </div>
        ))}
      </div>
    </>
  );
};

const Mini: React.FC<{ rows?: MiniRow[]; unit: string; me?: string; empty: string }> = ({ rows, unit, me, empty }) =>
  !rows?.length ? <p className="pg-empty">{empty}</p> : (
    <>
      <Podium rows={rows} me={me} unit={unit} />
      <div className="pg-list">
        {rows.filter((r) => r.rank > 3).map((r, i) => (
          <div className={`pg-row pg-lb ${r.name === me ? 'me' : ''}`} key={`${r.rank}-${r.name}`} style={{ '--i': i } as React.CSSProperties}>
            <Medal rank={r.rank} />
            <span className="nm">{r.name}{r.wallet ? ' 🔗' : ''}{r.name === me && <em className="pg-me-tag">{tr('tok.you')}</em>}</span>
            <b className="pg-lb-pts">{r.points} <small>{unit}</small></b>
          </div>
        ))}
      </div>
    </>
  );

/** Premios de esta semana para una categoría, p. ej. "Prizes: 🥇 1 USDC · 🥈 0.5 USDC". */
const PrizeLine: React.FC<{ b: BoardResult; cat: PrizeCat }> = ({ b, cat }) => {
  const list = b.prizes?.[cat];
  if (!list?.length) return null;
  return (
    <p className="pg-mart-note">
      {tr('league.prizes', { list: list.map((x, i) => `${['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`} ${x} ${b.symbol ?? ''}`).join(' · ') })}
      {' '}{tr('league.prizesNeeds', { min: b.prizeMinHold ?? '', symbol: b.symbol ?? '' })}
    </p>
  );
};
const catLabel = (c: string) => tk(`cat.${c}`, c);

/** La Liga: leaderboard semanal y total, el feed del mundo y la ficha del entrenador. */
export const LeaguePanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useT();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('week');
  const [board, setBoard] = useState<BoardResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => {
      void refreshMe();
      return fetchBoard().then((b) => { if (alive) { setBoard(b); setErr(null); } }).catch((e: Error) => alive && setErr(e.message));
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const t = online.trainer;
  const save = async () => {
    const e = await rename(name.trim());
    if (e) setErr(e); else { setEditing(false); setErr(null); }
  };

  return (
    <div className="pg-drawer pg-win pg-pn pg-league k-league">
      <h3>{tr('nav.league')} <button className="x" onClick={onClose}>✕</button></h3>
      {t ? (
        <div className="pg-trainer">
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="pg-rename">
              <input autoFocus maxLength={20} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button className="pg-btn small" type="submit">{tr('league.save')}</button>
            </form>
          ) : (
            <button className="pg-trainer-name" onClick={() => { setName(t.name); setEditing(true); }} title={tr('league.renameTitle')}>
              <span className="av">{t.name.slice(0, 1).toUpperCase()}</span>{t.name} <small>✎</small>
              {board?.myRank ? <span className="pg-rk-chip">#{board.myRank}</span> : null}
            </button>
          )}
          <div className="pg-trainer-stats">
            <span><b>{t.weekPoints}</b> {tr('league.thisWeek')}</span>
            <span><b>{t.score}</b> {tr('league.total')}</span>
            <span><b>{t.stats.catches ?? 0}</b> {tr('league.caughtN')}</span>
            <span><b>{t.stats.disc ?? 0}</b> {tr('league.discoveredN')}</span>
          </div>
          {!t.wallet && <p className="pg-mart-note">{tr('league.guest')}</p>}
        </div>
      ) : (
        <p className="pg-mart-note">{tr(online.status === 'connecting' ? 'league.connecting' : 'league.offline')}</p>
      )}

      <div className="pg-tabs">
        <button className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>{tr('league.tab.week')}</button>
        <button className={tab === 'arena' ? 'on' : ''} onClick={() => setTab('arena')}>{tr('league.tab.arena')}</button>
        <button className={tab === 'disc' ? 'on' : ''} onClick={() => setTab('disc')}>{tr('league.tab.disc')}</button>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>{tr('league.tab.all')}</button>
        <button className={tab === 'winners' ? 'on' : ''} onClick={() => setTab('winners')}>{tr('league.tab.winners')}</button>
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>{tr('league.tab.feed')}</button>
      </div>
      {err && <p className="pg-mart-note">{err}</p>}
      {!board ? <p className="pg-empty">{tr('common.loading')}</p> : tab === 'arena' ? (
        <>
          <p className="pg-mart-note">{tr('league.arenaNote', { t: left(board.weekEndsAt) })}</p>
          <PrizeLine b={board} cat="arena" />
          <Mini rows={board.arena} unit={tr('league.wins')} me={t?.name} empty={tr('league.noArena')} />
        </>
      ) : tab === 'disc' ? (
        <>
          <p className="pg-mart-note">{tr('league.discNote')}</p>
          <PrizeLine b={board} cat="discoverer" />
          <Mini rows={board.discoverers} unit={tr('league.found')} me={t?.name} empty={tr('league.noDisc')} />
        </>
      ) : tab === 'winners' ? (
        !board.winners?.length ? <p className="pg-empty">{tr('league.noWinners')}</p> : (
          <div className="pg-list">
            {board.winners.map((w, i) => (
              <div className="pg-row pg-lb" key={w.id} style={{ '--i': i } as React.CSSProperties}>
                <span className="no">W{w.week}</span>
                <span className="nm">{w.name}</span>
                <span className="pg-lb-sub">{catLabel(w.category)} #{w.rank} · {w.status === 'paid' && w.txHash ? <a className="pg-link" href={txUrl(w.txHash)} target="_blank" rel="noreferrer">{tr('league.paid')}</a> : tr(w.status === 'paid' ? 'league.paid' : 'league.pending')}</span>
                <b className="pg-lb-pts">{w.amount} <small>{w.symbol}</small></b>
              </div>
            ))}
          </div>
        )
      ) : tab === 'feed' ? (
        board.feed.length ? <div className="pg-list">{board.feed.map((f, i) => <FeedLine f={f} i={i} key={f.id} />)}</div> : <p className="pg-empty">{tr('league.nothing')}</p>
      ) : (
        <>
          {tab === 'week' && <p className="pg-mart-note">{tr('league.weekNote', { t: left(board.weekEndsAt) })}</p>}
          {tab === 'week' && <PrizeLine b={board} cat="league" />}
          <Rows rows={tab === 'week' ? board.week : board.allTime} me={t?.name} />
        </>
      )}
    </div>
  );
};
