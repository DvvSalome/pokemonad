// La interfaz del Coliseo Monad: guardián, verificación on-chain, elección de jefe y combate de trivia.
//
// Todo el módulo vive en esta capa y en academyStore; el mundo 3D solo pone la arena y los modelos. Las
// cuatro pantallas comparten el mismo lenguaje (ver academy.css) y se montan sobre el juego sin
// desmontarlo: durante el combate la arena sigue viéndose detrás del panel de preguntas.
import React, { useEffect } from 'react';
import { BOSSES, bossById } from './questions';
import { ACADEMY_ADDRESS, chain, explorerTx, FAUCET_URL, hasWallet, onChainReady } from './monad';
import {
  ASK_SECONDS, PLAYER_HP, answer, claimBadge, closeAcademy, endBattle, enterAsGuest,
  hasBadge, nextTurn, openGate, startBattle, talkTo, totalBadges, useAcademy, verifyAndEnter,
} from './academyStore';
import { INTRO } from '../world/academyStage';
import type { MonType } from '../world/species';
import { sfx } from '../audio/sound';
import './academy.css';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const LETTERS = ['A', 'B', 'C', 'D'];

/** Aviso al acercarse a un tutor o al guardián. El tutor gana: su pelea empieza hablando con él. */
const ApproachHint: React.FC = () => {
  const a = useAcademy();
  if (a.nearTutor != null) {
    const b = bossById(a.nearTutor);
    return (
      <button className="mon mon-hint" onClick={() => talkTo(b.id)}>
        <kbd>E</kbd> Hablar con {b.name}
      </button>
    );
  }
  if (!a.nearGuard) return null;
  return (
    <button className="mon mon-hint" onClick={openGate}>
      <kbd>E</kbd> Hablar con el Guardián del Coliseo
    </button>
  );
};

/** Diálogo del tutor: qué enseña y el botón que entra directo a su pelea. */
const Talk: React.FC = () => {
  const a = useAcademy();
  if (a.talking == null) return null;
  const b = bossById(a.talking);
  const color = `#${b.color.toString(16).padStart(6, '0')}`;
  return (
    <div className="mon mon-screen">
      <div className="mon-panel mon-gate">
        <div className="who">
          <span className="sigil" style={{ color, borderColor: color }}>◆</span>
          <div>
            <p className="mon-eyebrow">{b.level} · lección de Monad</p>
            <h2 className="mon-h1">{b.name}</h2>
          </div>
        </div>
        <p className="say">«{b.challenge}»</p>
        <p className="mon-p" style={{ color }}>{b.topic}</p>
        <ul className="mon-beats">
          {b.beats.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <div className="acts">
          <button className="mon-btn solid" onClick={() => startBattle(b.id)}>Entrar a la pelea</button>
          <button className="mon-btn ghost" onClick={closeAcademy}>Seguir caminando</button>
        </div>
      </div>
    </div>
  );
};

const Gate: React.FC = () => {
  const a = useAcademy();
  return (
    <div className="mon mon-screen">
      <div className="mon-panel mon-gate">
        <div className="who">
          <span className="sigil">👁</span>
          <div>
            <p className="mon-eyebrow">Coliseo Monad · control de acceso</p>
            <h2 className="mon-h1">El Guardián</h2>
          </div>
        </div>

        <p className="say">
          «En Monad el ecosistema se lee en un explorador. Esta arena existe para que lo demuestres
          jugando. Los tres tutores de la explanada te llevan directo a su pelea. Yo solo apunto tu
          dirección en la cadena: una transacción diminuta, porque aquí el gas casi no cuesta.»
        </p>

        <div className="rows">
          <div className="row"><span>Red</span><b>{chain.name} · chainId {chain.id}</b></div>
          <div className="row"><span>Contrato</span><b className="mon-mono">{ACADEMY_ADDRESS ? short(ACADEMY_ADDRESS) : 'sin desplegar · modo demo'}</b></div>
          <div className="row"><span>Gas</span><b>{onChainReady ? 'MON · Monad testnet' : 'una firma, sin gas'}</b></div>
          {a.address && <div className="row"><span>Wallet</span><b className="mon-mono">{short(a.address)}</b></div>}
        </div>

        {a.error && <p className="mon-err">{a.error}</p>}
        {a.busy && <p className="mon-busy" style={{ marginTop: 12 }}><i />{a.busy}</p>}

        <div className="acts">
          <button className="mon-btn solid" onClick={() => void verifyAndEnter()} disabled={!!a.busy}>
            {hasWallet() ? 'Verificar y entrar' : 'Conectar wallet'}
          </button>
          <button className="mon-btn ghost" onClick={enterAsGuest} disabled={!!a.busy}>Entrar como invitado</button>
          <button className="mon-btn ghost" onClick={closeAcademy} disabled={!!a.busy}>Marcharse</button>
        </div>
        <p className="mon-p"><a className="mon-link" href={FAUCET_URL} target="_blank" rel="noreferrer">Pedir MON de prueba en el faucet ↗</a></p>
        {!hasWallet() && (
          <p className="mon-p">
            No se detecta ninguna wallet. Puedes entrar como invitado y hacer el temario completo; la
            insignia on-chain queda pendiente.
          </p>
        )}
      </div>
    </div>
  );
};

const Roster: React.FC = () => {
  const a = useAcademy();
  return (
    <div className="mon mon-screen">
      <div className="mon-roster">
        <div className="head">
          <div>
            <p className="mon-eyebrow">Academia del Coliseo Monad</p>
            <h2 className="mon-h1">Elige a tu jefe</h2>
            <p className="mon-p">Los mismos tres están en la explanada. Hablar con uno entra directo a su pelea. Aciertas, pegas; fallas, te pega y aprendes por qué.</p>
          </div>
          <div className="count">
            Insignias<br /><b className="mon-mono" style={{ fontSize: 22 }}>{totalBadges()} / {BOSSES.length}</b>
            {a.address && <><br />{short(a.address)}</>}
          </div>
        </div>

        <div className="mon-cards">
          {BOSSES.map((b) => (
            <button key={b.key} className="mon-panel mon-card" onClick={() => startBattle(b.id)}>
              <span className="lvl">{b.level}</span>
              <span className="nm">{b.name}</span>
              <span className="tp">{b.topic}</span>
              <span className="meta" style={{ color: `#${b.color.toString(16).padStart(6, '0')}` }}>
                <span className="pips">{Array.from({ length: b.hp }, (_, i) => <i key={i} />)}</span>
                <span>{b.hp} aciertos</span>
                {hasBadge(b.id) && <span className="done">✓ superado</span>}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="mon-btn ghost" onClick={closeAcademy}>Salir del coliseo</button>
          {a.txHash && <a className="mon-link" href={explorerTx(a.txHash)} target="_blank" rel="noreferrer">ver matrícula en el explorador ↗</a>}
        </div>
      </div>
    </div>
  );
};

/** Cortinilla: franjas que tapan la pantalla. El cambio de mundo a arena (y al revés) ocurre tapado. */
const Wipe: React.FC<{ n: number }> = ({ n }) => {
  if (!n) return null;
  return (
    <div className="mon-wipe" key={n} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ ['--i' as string]: i }} />)}
      <span className="sigil" />
    </div>
  );
};

/** Cartel de entrada: los dos nombres enfrentados mientras la cámara hace el vuelo de presentación. */
const VsSplash: React.FC<{ name: string; level: string }> = ({ name, level }) => (
  <div
    className="mon-vs"
    style={{ ['--vsAt' as string]: `${INTRO.vsAt}s`, ['--vsSlam' as string]: `${INTRO.vsSlam}s`, ['--vsEnd' as string]: `${INTRO.vsEnd}s` }}
    aria-hidden
  >
    <div className="half you"><small>Tú</small><b>Retador</b></div>
    <div className="slash" />
    <div className="half foe"><small>{level}</small><b>{name}</b></div>
    <div className="emblem">VS</div>
  </div>
);

const Battle: React.FC = () => {
  const a = useAcademy();
  const b = a.battle;

  // 1–4 responden; Enter sigue cuando ya se vio el golpe. Durante la embestida no se acepta nada.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = a.battle;
      if (!cur) return;
      if (cur.turn === 'ask') {
        const n = Number(e.key);
        if (n >= 1 && n <= cur.queue[cur.i].options.length) answer(n - 1);
      } else if (cur.turn === 'verdict' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        nextTurn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a.battle]);

  // El jefe aparece y el jugador enciende su sello: los mismos puntos del vuelo de cámara.
  useEffect(() => {
    if (!b || b.turn !== 'intro' || a.view !== 'arena') return;
    const ms = (s: number) => s * 1000;
    const ts = [setTimeout(() => sfx.appear(), ms(INTRO.bossAt)), setTimeout(() => sfx.appear(), ms(INTRO.playerAt))];
    return () => ts.forEach(clearTimeout);
  }, [a.view, b?.turn]);

  useEffect(() => {
    const anim = b?.anim;
    if (!anim) return;
    if (anim.phase === 'wind') sfx.cast((anim.by === 'player' ? 'Electric' : 'Ghost') as MonType);
    else sfx.hit(true, anim.ko);
  }, [b?.anim?.id, b?.anim?.phase]);

  if (!b) return null;
  const q = b.queue[b.i];
  const foeColor = `#${b.boss.color.toString(16).padStart(6, '0')}`;
  const intro = b.turn === 'intro';
  const asking = b.turn === 'ask';
  const verdict = b.turn === 'verdict';
  const ok = !!b.anim?.ok || (verdict && b.chosen === q.answer);

  return (
    <div className={`mon mon-layer${a.closing ? ' closing' : ''}`}>
      {intro && <VsSplash name={b.boss.name} level={b.boss.level} />}
      {!intro && (
        <div className="mon-top">
          <div className="mon-panel mon-foe" style={{ ['--mon-foe-color' as string]: foeColor }}>
            <div className="nm">{b.boss.name} <small>{b.boss.level}</small></div>
            <div className="mon-hp">
              {Array.from({ length: b.boss.hp }, (_, i) => <i key={i} className={i < b.bossHp ? 'on' : ''} />)}
            </div>
          </div>
          <button className="mon-btn ghost exit" onClick={() => endBattle('closed')} disabled={b.turn === 'resolve'}>Rendirse</button>
        </div>
      )}

      <div />

      {b.turn === 'resolve' && (
        <div className={`mon-call ${b.anim?.ok ? 'ok' : 'ko'}`} aria-hidden>
          {b.anim?.phase === 'wind'
            ? (b.anim.ok ? 'Cargas el sello…' : `${b.boss.name} carga…`)
            : (b.anim?.ok ? '¡CERTERO!' : '¡FALLO!')}
        </div>
      )}

      {asking && (
        <div className="mon-panel mon-ask">
          <div className={`clock${b.left <= 8 ? ' low' : ''}`}><i style={{ width: `${(b.left / ASK_SECONDS) * 100}%` }} /></div>
          <p className="lesson">{b.boss.topic}</p>
          <p className="q">{q.q}</p>
          <div className="opts">
            {q.options.map((o, i) => (
              <button key={i} className="mon-opt" onClick={() => answer(i)}>
                <b>{LETTERS[i]}</b>{o}
              </button>
            ))}
          </div>
        </div>
      )}

      {verdict && (
        <div className={`mon-panel mon-verdict ${ok ? 'ok' : 'ko'}`}>
          <div className="tag">
            {ok ? '◆ Golpe certero' : b.chosen === -1 ? '✕ Se acabó el tiempo' : '✕ Fallo'}
            <span style={{ color: '#8f86ad', letterSpacing: 1, fontWeight: 500, fontSize: 12 }}>
              {ok ? `−1 vida a ${b.boss.name}` : '−1 vida para ti'}
            </span>
          </div>
          <p className="why">
            {!ok && <><b>La respuesta era: </b>{q.options[q.answer]}. </>}
            {q.why}
          </p>
          <div className="foot">
            <a className="mon-link" href={q.doc} target="_blank" rel="noreferrer">estudiar este tema ↗</a>
            <button className="mon-btn solid" onClick={nextTurn}>
              {b.bossHp <= 0 ? 'Rematar' : b.playerHp <= 0 ? 'Ver resultado' : 'Siguiente ronda'}
            </button>
          </div>
        </div>
      )}

      {!intro && (
        <div className="mon-panel mon-you">
          <span className="lbl">Tu vida</span>
          <span className="hearts">
            {Array.from({ length: PLAYER_HP }, (_, i) => <i key={i} className={i < b.playerHp ? 'on' : ''} />)}
          </span>
          <span className="lbl" style={{ marginLeft: 8 }}>Aciertos {b.recap.hits} · Fallos {b.recap.misses}</span>
        </div>
      )}
    </div>
  );
};

const Result: React.FC = () => {
  const a = useAcademy();
  const b = a.battle;
  if (!b) return null;
  const win = !!b.win;
  const score = Math.round((b.recap.hits / Math.max(1, b.recap.hits + b.recap.misses)) * 100);
  const failed = b.recap.study;

  return (
    <div className={`mon mon-layer${a.closing ? ' closing' : ''}`}>
      <div />
      <div className="mon-panel mon-result">
        <p className="mon-eyebrow">{win ? 'Módulo superado' : 'Derrota'}</p>
        <div className="badge">{win ? '🏅' : '💀'}</div>
        <h2 className="mon-h1">{win ? b.boss.name : 'Vuelve cuando lo tengas'}</h2>
        <p className="mon-p">
          {win
            ? `Has demostrado que dominas ${b.boss.topic.toLowerCase()}. La insignia es intransferible: certifica a tu wallet, no a tu inventario.`
            : 'El jefe te ha tumbado, pero te llevas las explicaciones. Repasa estos temas y vuelve: las preguntas se barajan cada combate.'}
        </p>

        <div className="score">
          <div>{b.recap.hits}<span>Aciertos</span></div>
          <div>{b.recap.misses}<span>Fallos</span></div>
          <div>{score}%<span>Nota</span></div>
        </div>

        {!win && (
          <div className="study">
            {failed.slice(0, 4).map((q, i) => (
              <a key={i} href={q.doc} target="_blank" rel="noreferrer">↗ {q.q}</a>
            ))}
          </div>
        )}

        {a.error && <p className="mon-err">{a.error}</p>}
        {a.busy && <p className="mon-busy" style={{ marginTop: 12 }}><i />{a.busy}</p>}
        {win && a.txHash && <p className="mon-p"><a className="mon-link" href={explorerTx(a.txHash)} target="_blank" rel="noreferrer">ver la insignia en el explorador ↗</a></p>}
        {win && !onChainReady && <p className="mon-p">Modo demostración: la insignia queda guardada en este navegador. Despliega <b>AcademyGatekeeper.sol</b> y rellena <b>VITE_ACADEMY_CONTRACT</b> para acuñarla en Monad.</p>}

        <div className="acts">
          {win && onChainReady && a.address && (
            <button className="mon-btn solid" onClick={() => void claimBadge()} disabled={!!a.busy}>Acuñar insignia</button>
          )}
          <button className="mon-btn" onClick={() => startBattle(b.boss.id)}>Repetir combate</button>
          <button className="mon-btn ghost" onClick={() => endBattle('roster')}>Elegir otro jefe</button>
          <button className="mon-btn ghost" onClick={() => endBattle('closed')}>Salir al mundo</button>
        </div>
      </div>
      <div />
    </div>
  );
};

export const AcademyUI: React.FC = () => {
  const a = useAcademy();

  // E abre la puerta cuando el guardián está cerca; Esc sale de las pantallas que no son combate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const st = a;
      if ((e.key === 'e' || e.key === 'E') && st.phase === 'closed' && st.nearTutor != null) talkTo(st.nearTutor);
      else if ((e.key === 'e' || e.key === 'E') && st.phase === 'closed' && st.nearGuard) openGate();
      else if (e.key === 'Escape' && (st.phase === 'gate' || st.phase === 'roster' || st.phase === 'talk')) closeAcademy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a]);

  // La cortinilla vive por encima de cualquier pantalla: tapa el salto al entrar y el salto al salir.
  const wipe = <Wipe n={a.wipe} />;
  useEffect(() => { if (a.wipe) sfx.wipe(); }, [a.wipe]);

  if (a.phase === 'closed') return <><ApproachHint />{wipe}</>;
  if (a.phase === 'talk') return <><Talk />{wipe}</>;
  if (a.phase === 'gate') return <><Gate />{wipe}</>;
  if (a.phase === 'roster') return <><Roster />{wipe}</>;
  if (a.phase === 'battle' && a.battle?.turn === 'over') return <><Result />{wipe}</>;
  if (a.phase === 'battle') return <><Battle />{wipe}</>;
  return wipe;
};
