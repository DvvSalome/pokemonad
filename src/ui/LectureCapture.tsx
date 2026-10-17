// Encuentro de los profesores: no es la captura de PokeScout. El monstruo está en un atril, se le
// convence con un sello y, si se queda, da la clase asintiendo mientras el texto se escribe.
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { BALL_ORDER, type BallKey } from '../world/species';
import {
  useCapture, live, selectBall, throwBall, runAway, endEncounter,
} from '../world/captureStore';
import { useBattle } from '../world/battleStore';
import { spawnById } from '../world/wildStore';
import { professorLesson } from '../world/professors';
import { toonifyObject } from '../world/toon';
import { t, useT } from '../i18n';

const SEAL: Record<BallKey, { color: string; key: 'shop.seal.ball' | 'shop.seal.super' | 'shop.seal.hyper' | 'shop.seal.hood' }> = {
  ball: { color: '#3c8f4a', key: 'shop.seal.ball' },
  super: { color: '#2a62c9', key: 'shop.seal.super' },
  hyper: { color: '#6d4ad4', key: 'shop.seal.hyper' },
  hood: { color: '#e0a106', key: 'shop.seal.hood' },
};

const Lecturer: React.FC<{ url: string; talking: boolean }> = ({ url, talking }) => {
  const { scene, animations } = useGLTF(url);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const fittedPack = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    toonifyObject(cloned, { outline: 0.035, rim: 0.22 });
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const s = 0.78 / Math.max(size.y, 0.01);
    cloned.scale.setScalar(s);
    cloned.position.set(-center.x * s, -center.y * s, -center.z * s);
    cloned.traverse((o) => { o.frustumCulled = false; });
    return { object: cloned, homeY: cloned.position.y };
  }, [scene]);
  const fitted = fittedPack.object;

  useEffect(() => {
    const m = new THREE.AnimationMixer(fitted);
    mixer.current = m;
    const find = (re: RegExp) => animations.find((a) => re.test(a.name));
    const idle = find(/\|Idle$/i) || find(/Flying_Idle/i) || find(/Jump_Idle/i) || animations[0];
    if (idle) m.clipAction(idle).reset().play();
    return () => { m.stopAllAction(); mixer.current = null; };
  }, [fitted, animations, talking]);

  useFrame((_, dt) => {
    mixer.current?.update(dt);
    const time = performance.now() / 1000;
    if (talking) {
      fitted.rotation.y = Math.sin(time * 1.7) * 0.22;
      fitted.rotation.x = Math.sin(time * 4.2) * 0.04;
      fitted.position.y = fittedPack.homeY + Math.sin(time * 3.1) * 0.02;
    } else {
      fitted.rotation.set(0, 0, 0);
      fitted.position.y = fittedPack.homeY;
    }
  });

  return <primitive object={fitted} />;
};

export const LectureCapture: React.FC = () => {
  const cap = useCapture();
  const battle = useBattle();
  useT();
  const meter = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState('');

  const spawn = cap.activeId ? spawnById(cap.activeId) : undefined;
  const lesson = cap.activeId ? professorLesson(cap.activeId) : null;
  const teaching = cap.result === 'caught' && !!lesson;

  useEffect(() => {
    if (!cap.activeId) return;
    let raf = 0;
    const tick = () => {
      const el = meter.current;
      if (el) el.style.setProperty('--k', String(live.ringK));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cap.activeId]);

  useEffect(() => {
    if (!teaching || !lesson) { setTyped(''); return; }
    setTyped('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(lesson.slice(0, i));
      if (i >= lesson.length) window.clearInterval(id);
    }, 28);
    return () => window.clearInterval(id);
  }, [teaching, lesson, cap.activeId]);

  if (!cap.activeId || battle.active || !spawn) return null;
  const busy = cap.phase !== 'aim';
  const sealing = cap.phase === 'throw' || cap.phase === 'absorb' || cap.phase === 'shake';
  const failed = cap.result === 'broke' || cap.result === 'fled';

  return (
    <div className={`lx ${teaching ? 'teaching' : ''} ${sealing ? 'sealing' : ''}`}>
      <div className="lx-stage">
        <div className="lx-lamp" />
        <Canvas className="lx-view" camera={{ position: [0, 0.35, 4.4], fov: 34 }} gl={{ alpha: true, antialias: true }} onCreated={({ camera }) => camera.lookAt(0, 0.35, 0)}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[1.6, 2.8, 2.4]} intensity={1.7} />
          <Suspense fallback={null}>
            <Lecturer url={spawn.model} talking={teaching} />
          </Suspense>
        </Canvas>
        <i className="lx-podium" />
        {sealing && <i className="lx-wax" />}
        {teaching && (
          <div className="lx-bubble" key={cap.activeId}>
            <span>{typed}</span>
            <i />
          </div>
        )}
      </div>

      <aside className="lx-side">
        <small>{t('shop.prof')}</small>
        <h2>{spawn.species.name}</h2>
        {cap.phase === 'aim' && (
          <>
            <p>{t('shop.focus')}</p>
            <div className="lx-meter" ref={meter}>
              <i />
              <b />
            </div>
            <div className="lx-seals">
              {BALL_ORDER.map((k) => (
                <button
                  key={k}
                  className={cap.ball === k ? 'on' : ''}
                  disabled={busy || cap.balls[k] <= 0}
                  onClick={() => selectBall(k)}
                  style={{ ['--seal' as string]: SEAL[k].color }}
                >
                  <em />
                  <span>{t(SEAL[k].key)}</span>
                  <strong>{cap.balls[k]}</strong>
                </button>
              ))}
            </div>
            <div className="lx-acts">
              <button className="go" disabled={busy || cap.balls[cap.ball] <= 0} onClick={() => throwBall()}>{t('shop.convince')}</button>
              <button className="ghost" disabled={busy} onClick={runAway}>{t('shop.leave')}</button>
            </div>
          </>
        )}
        {sealing && <p className="lx-wait">{t('shop.sealing')}</p>}
        {teaching && (
          <div className="lx-board">
            <small>{t('shop.board')}</small>
            <p>{typed}</p>
            <button onClick={endEncounter}>{t('shop.ok')}</button>
          </div>
        )}
        {cap.result === 'caught' && !lesson && (
          <div className="lx-board">
            <p>{cap.message}</p>
            <button onClick={endEncounter}>{t('shop.ok')}</button>
          </div>
        )}
        {failed && cap.phase !== 'aim' && (
          <div className="lx-board">
            <p>{cap.message}</p>
          </div>
        )}
      </aside>
    </div>
  );
};
