// La captura de un profesor de campo, como escena 3D con su propia coreografía.
//
// Antes esto era un panel: el monstruo quieto en un atril, un círculo naranja que aparecía encima y la
// lección. Ahora es un plano de cine en tres actos que sigue al pie de la letra los tiempos de
// captureStore (capture/timing.ts), así que lo que se ve y lo que se decide nunca se desincronizan:
//
//   1. LANZAR — el sello sale de primer plano girando, en parábola, con estela, y el aro de enfoque se
//      cierra sobre el profesor según la calidad del tiro.
//   2. SELLAR — el sello se abre delante de él, lo baña un haz de luz, el profesor se vuelve incandescente
//      y entra en espiral mientras las chispas convergen. Luego el sello cae al pedestal, rebota y tiembla
//      una vez por cada "casi": cada temblor suelta un anillo y la runa del pedestal parpadea.
//   3. RESOLVER — si se queda: clic, onda dorada, estrellas y el profesor sale de un salto a dar la clase.
//      Si se suelta: el sello se agrieta, revienta en esquirlas y el profesor reaparece sobresaltado.
//
// Todo el movimiento sale de una función de tiempo por fase (no de estados intermedios), así que un
// fotograma cualquiera se puede reconstruir solo con "qué fase" y "cuánto lleva".
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { BALL_ORDER, type BallKey } from '../world/species';
import {
  useCapture, live, selectBall, throwBall, runAway, endEncounter, type Phase,
} from '../world/captureStore';
import { THROW_MS, ABSORB_MS, DROP_MS, WOBBLE_MS, SWING_MS, BROKE_MS, AB } from '../world/capture/timing';
import { useBattle } from '../world/battleStore';
import { spawnById } from '../world/wildStore';
import { professorLesson } from '../world/professors';
import { toonifyObject } from '../world/toon';
import { t, useT } from '../i18n';
import './capture.css';

// ---------------------------------------------------------------- sellos

const SEAL: Record<BallKey, { hex: number; css: string; key: 'shop.seal.ball' | 'shop.seal.super' | 'shop.seal.hyper' | 'shop.seal.hood' }> = {
  ball: { hex: 0x4cd38a, css: '#4cd38a', key: 'shop.seal.ball' },
  super: { hex: 0x4c8dff, css: '#4c8dff', key: 'shop.seal.super' },
  hyper: { hex: 0xa66bff, css: '#a66bff', key: 'shop.seal.hyper' },
  hood: { hex: 0xffc23d, css: '#ffc23d', key: 'shop.seal.hood' },
};

// ---------------------------------------------------------------- puesta en escena

/** Cota de la tapa del pedestal; el profesor flota encima y el sello cae sobre ella. */
const PED_Y = -0.43;
const SEAL_R = 0.12;
/**
 * La cámara mira por DEBAJO del pedestal: así profesor y pedestal suben a la mitad alta de la pantalla y la
 * tarjeta de abajo no los tapa.
 */
const LOOK_Y = -0.42;
// A un lado y por encima de la tarjeta de abajo: si estuviera centrado en primer plano, la tarjeta lo taparía.
const READY = new THREE.Vector3(0.62, -0.02, 1.7);
const HOVER = new THREE.Vector3(0, 0.08, 0.6);
const REST = new THREE.Vector3(0, PED_Y + SEAL_R, 0.12);

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOutBack = (x: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

/** Reloj de fase: cuánto lleva la fase actual, en segundos. Lo comparten todas las piezas de la escena. */
const clock = { phase: 'aim' as Phase, t0: 0, t: 0 };

// ---------------------------------------------------------------- partículas

const MAXP = 140;
interface Part { on: boolean; p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; c: THREE.Color; g: number; drag: number; home?: THREE.Vector3 }

/** Un solo sistema de partículas para todos los efectos: chispas, implosión, esquirlas y polvo. */
const parts: Part[] = Array.from({ length: MAXP }, () => ({
  on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 0.02, c: new THREE.Color(), g: 0, drag: 1,
}));
let cursor = 0;
function emit(n: number, at: THREE.Vector3, opts: { speed: number; up?: number; color: number; color2?: number; size: number; life: number; g?: number; drag?: number; home?: THREE.Vector3; spread?: number }) {
  const c1 = new THREE.Color(opts.color), c2 = new THREE.Color(opts.color2 ?? opts.color);
  for (let i = 0; i < n; i++) {
    const q = parts[cursor]; cursor = (cursor + 1) % MAXP;
    q.on = true;
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    if (opts.home) {
      // Implosión: nacen en una cáscara alrededor del objetivo y caen hacia él.
      q.p.copy(opts.home).addScaledVector(dir, opts.spread ?? 0.7);
      q.v.copy(dir).multiplyScalar(-opts.speed);
      q.home = opts.home.clone();
    } else {
      q.p.copy(at);
      q.v.copy(dir).multiplyScalar(opts.speed * (0.4 + Math.random() * 0.8));
      q.v.y += opts.up ?? 0;
      q.home = undefined;
    }
    q.life = 0; q.max = opts.life * (0.7 + Math.random() * 0.6);
    q.size = opts.size * (0.6 + Math.random() * 0.8);
    q.c.copy(c1).lerp(c2, Math.random());
    q.g = opts.g ?? 0; q.drag = opts.drag ?? 1.2;
  }
}

const Particles: React.FC = () => {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      MAXP,
    );
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAXP; i++) m.setColorAt(i, new THREE.Color(0, 0, 0));
    return m;
  }, []);
  const o = useMemo(() => new THREE.Object3D(), []);
  const dark = useMemo(() => new THREE.Color(0, 0, 0), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    for (let i = 0; i < MAXP; i++) {
      const q = parts[i];
      if (!q.on) { o.scale.setScalar(0); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); mesh.setColorAt(i, dark); continue; }
      q.life += dt;
      const k = q.life / q.max;
      if (k >= 1) { q.on = false; continue; }
      if (q.home) {
        // Atracción: acelera hacia el sello y muere al llegar.
        const to = q.home.clone().sub(q.p);
        q.v.addScaledVector(to, dt * 18);
        if (to.length() < 0.04) { q.on = false; continue; }
      }
      q.v.y -= q.g * dt;
      q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      o.position.copy(q.p);
      o.rotation.set(q.life * 7 + i, q.life * 5, 0);
      o.scale.setScalar(q.size * (1 - k * 0.6));
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, new THREE.Color().copy(q.c).multiplyScalar(1 - k * k));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return <primitive object={mesh} />;
};

// ---------------------------------------------------------------- anillos de onda

const RINGS = 5;
interface RingFx { t: number; max: number; at: THREE.Vector3; color: THREE.Color; size: number; flat: boolean }
const rings: RingFx[] = Array.from({ length: RINGS }, () => ({ t: 99, max: 1, at: new THREE.Vector3(), color: new THREE.Color(), size: 1, flat: true }));
let ringCursor = 0;
function pulse(at: THREE.Vector3, color: number, size: number, max = 0.7, flat = true) {
  const r = rings[ringCursor]; ringCursor = (ringCursor + 1) % RINGS;
  r.t = 0; r.max = max; r.at.copy(at); r.color.setHex(color); r.size = size; r.flat = flat;
}

const Rings: React.FC = () => {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    rings.forEach((r, i) => {
      const m = refs.current[i];
      if (!m) return;
      r.t += dt;
      const k = r.t / r.max;
      m.visible = k < 1;
      if (k >= 1) return;
      m.position.copy(r.at);
      m.rotation.set(r.flat ? -Math.PI / 2 : 0, 0, 0);
      m.scale.setScalar(r.size * (0.15 + ease(k) * 1.1));
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.copy(r.color);
      mat.opacity = (1 - k) * 0.95;
    });
  });
  return (
    <>
      {Array.from({ length: RINGS }, (_, i) => (
        <mesh key={i} ref={(m) => { refs.current[i] = m; }} visible={false}>
          <ringGeometry args={[0.86, 1, 64]} />
          <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
};

// ---------------------------------------------------------------- pedestal

const Pedestal: React.FC<{ color: number }> = ({ color }) => {
  const rune = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const ph = clock.phase, tt = clock.t;
    const r = rune.current, g = glow.current;
    if (!r || !g) return;
    // La runa gira despacio; durante el sellado se acelera y parpadea con cada temblor.
    const sealing = ph === 'shake' || ph === 'absorb';
    r.rotation.z += sealing ? 0.04 : 0.006;
    const wob = ph === 'shake' && tt > DROP_MS / 1000 ? Math.pow(Math.max(0, Math.sin(((tt - DROP_MS / 1000) / (WOBBLE_MS / 1000)) * Math.PI * 2)), 6) : 0;
    const caught = ph === 'caught' ? Math.max(0, 1 - tt * 0.8) : 0;
    const k = 0.45 + wob * 0.5 + caught * 0.8 + (sealing ? 0.15 : 0);
    (r.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k);
    (g.material as THREE.MeshBasicMaterial).opacity = 0.18 + wob * 0.25 + caught * 0.5;
    (r.material as THREE.MeshBasicMaterial).color.setHex(ph === 'caught' ? 0xffd36b : ph === 'broke' ? 0xff6a5c : color);
  });
  return (
    <group position={[0, PED_Y, 0]}>
      {/* Tambor de piedra con un bisel: la forma la da la luz suave, no un contorno. */}
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <cylinderGeometry args={[0.62, 0.7, 0.32, 48]} />
        <meshStandardMaterial color={0x3a3350} roughness={0.85} />
      </mesh>
      <mesh position={[0, -0.01, 0]} receiveShadow>
        <cylinderGeometry args={[0.56, 0.62, 0.04, 48]} />
        <meshStandardMaterial color={0x58507a} roughness={0.7} />
      </mesh>
      <mesh ref={rune} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[0.38, 0.46, 6, 1]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.55, 48]} />
        <meshBasicMaterial color={0xffe2a8} transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
};

// ---------------------------------------------------------------- el profesor

const Lecturer: React.FC<{ url: string; talking: boolean }> = ({ url, talking }) => {
  const { scene, animations } = useGLTF(url);
  const group = useRef<THREE.Group>(null);
  const { object, mats } = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    toonifyObject(cloned, { outline: 0, rim: 0.28 });
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3(), center = new THREE.Vector3();
    box.getSize(size); box.getCenter(center);
    const s = 0.78 / Math.max(size.y, 0.01);
    cloned.scale.setScalar(s);
    cloned.position.set(-center.x * s, -center.y * s, -center.z * s);
    const list: THREE.MeshToonMaterial[] = [];
    cloned.traverse((o) => {
      o.frustumCulled = false;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) {
          if ((mat as THREE.MeshToonMaterial).emissive) list.push(mat as THREE.MeshToonMaterial);
        }
      }
    });
    return { object: cloned, mats: list };
  }, [scene]);

  const mixer = useMemo(() => new THREE.AnimationMixer(object), [object]);
  const acts = useMemo(() => {
    const find = (re: RegExp) => animations.find((a) => re.test(a.name)) ?? null;
    const act = (c: THREE.AnimationClip | null) => (c ? mixer.clipAction(c) : null);
    return {
      idle: act(find(/\|Idle$/i) ?? find(/Flying_Idle/i) ?? find(/Idle/i) ?? animations[0] ?? null),
      talk: act(find(/\|Yes$/i) ?? find(/Wave/i) ?? find(/Dance/i)),
      hit: act(find(/HitRe/i)),
      joy: act(find(/Dance|Jump$|Yes/i)),
    };
  }, [animations, mixer]);
  const cur = useRef<THREE.AnimationAction | null>(null);
  const play = (a: THREE.AnimationAction | null, loop = true) => {
    if (!a || cur.current === a) return;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.fadeIn(0.18).play();
    cur.current?.fadeOut(0.18);
    cur.current = a;
  };
  useEffect(() => { play(acts.idle); return () => { mixer.stopAllAction(); }; }, [acts]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastPhase = useRef<Phase>('aim');
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    mixer.update(dt);
    const g = group.current;
    if (!g) return;
    const ph = clock.phase, tt = clock.t, now = performance.now() / 1000;

    if (ph !== lastPhase.current) {
      lastPhase.current = ph;
      if (ph === 'broke') play(acts.hit ?? acts.idle, false);
      if (ph === 'aim') play(acts.idle);
    }
    if (talking && cur.current !== acts.talk) play(acts.talk ?? acts.idle);

    let scale = 1, y = Math.sin(now * 1.9) * 0.03, glow = 0, spin = 0, z = 0, visible = true, x = 0;
    if (ph === 'throw') {
      // Se da cuenta de lo que viene al final del vuelo: un respingo.
      const k = clamp01((tt - 0.45) / 0.27);
      scale = 1 + Math.sin(k * Math.PI) * 0.06;
    } else if (ph === 'absorb') {
      glow = clamp01((tt - AB.glow) / 0.2);
      const pull = clamp01((tt - AB.pullFrom) / (AB.pullTo - AB.pullFrom));
      const e = ease(pull);
      scale = (1 - e) * (1 + glow * 0.08);
      spin = e * Math.PI * 3;
      z = HOVER.z * e; y = HOVER.y * e + (1 - e) * y;
      visible = tt < AB.snap;
    } else if (ph === 'shake') {
      visible = false;
    } else if (ph === 'caught') {
      // Sale del sello de un salto, rebota y se planta en el pedestal a dar la clase.
      const k = clamp01((tt - 0.85) / 0.5);
      visible = tt > 0.85;
      scale = easeOutBack(k);
      y = Math.sin(clamp01((tt - 0.85) / 0.6) * Math.PI) * 0.25 + (talking ? Math.sin(now * 3.1) * 0.02 : 0);
      if (talking) spin = Math.sin(now * 1.7) * 0.22;
    } else if (ph === 'broke') {
      // Revienta el sello y reaparece sobresaltado: escala con rebote y un temblor que se apaga.
      const k = clamp01((tt - 0.3) / 0.45);
      visible = tt > 0.3;
      scale = easeOutBack(k);
      x = Math.sin(tt * 40) * 0.03 * (1 - clamp01((tt - 0.3) / 0.7));
      glow = Math.max(0, 1 - (tt - 0.3) * 3) * 0.6;
    } else if (ph === 'fled') {
      // Se escapa: encoge girando y sube hasta perderse.
      const k = clamp01(tt / 0.7);
      scale = 1 - ease(k);
      y = ease(k) * 1.6;
      spin = k * Math.PI * 4;
      visible = k < 1;
    }
    g.visible = visible;
    g.scale.setScalar(Math.max(0.0001, scale));
    g.position.set(x, y, z);
    g.rotation.y = spin;
    for (const m of mats) m.emissive.setRGB(glow * 1.2, glow * 1.05, glow * 0.8);
  });

  return <group ref={group}><primitive object={object} /></group>;
};

// ---------------------------------------------------------------- el sello

const Seal: React.FC<{ ball: BallKey }> = ({ ball }) => {
  const grp = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Group>(null);
  const band = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const trail = useRef<(THREE.Mesh | null)[]>([]);
  const hist = useRef<THREE.Vector3[]>(Array.from({ length: 6 }, () => new THREE.Vector3()));
  const fired = useRef<Record<string, boolean>>({});
  const color = SEAL[ball].hex;
  const lastPhase = useRef<Phase>('aim');
  const { camera, size } = useThree();
  // En pantallas estrechas (móvil, ventana vertical) la cámara se aleja hasta que pedestal y profesor
  // caben a lo ancho: con la distancia fija de escritorio el pedestal se salía por los lados.
  const camHome = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);
    const d = 3.6 * Math.max(1, 1.3 / aspect);
    return new THREE.Vector3(0, 0.32 + (d - 3.6) * 0.06, d);
  }, [size.width, size.height]);
  const shake = useRef(0);

  const pos = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = grp.current, sh = shell.current, bd = band.current, hl = halo.current, bm = beam.current;
    if (!g || !sh || !bd || !hl || !bm) return;
    const ph = clock.phase, tt = clock.t, now = performance.now() / 1000;
    if (ph !== lastPhase.current) { lastPhase.current = ph; fired.current = {}; }
    const once = (k: string) => (fired.current[k] ? false : (fired.current[k] = true));

    let visible = true, open = 0, spin = now * 1.2, tiltZ = 0, squash = 1, haloK = 0.35, beamK = 0;
    if (ph === 'aim') {
      // En primer plano, listo para lanzar, flotando y girando despacio.
      pos.copy(READY); pos.y += Math.sin(now * 2.2) * 0.02;
    } else if (ph === 'throw') {
      // Parábola de primer plano al profesor, con mucho giro y estela.
      const k = clamp01(tt / (THROW_MS / 1000));
      const e = 1 - Math.pow(1 - k, 2);
      pos.lerpVectors(READY, HOVER, e);
      pos.y += Math.sin(k * Math.PI) * 0.55;
      spin = k * Math.PI * 7;
      haloK = 0.5;
    } else if (ph === 'absorb') {
      // Se detiene delante, se abre, baña al profesor con un haz y lo absorbe.
      pos.copy(HOVER); pos.y += Math.sin(now * 9) * 0.01;
      open = ease(clamp01((tt - AB.open) / 0.25)) * (1 - ease(clamp01((tt - AB.snap) / 0.12)));
      beamK = clamp01((tt - AB.beam) / 0.12) * (1 - clamp01((tt - AB.pullTo) / 0.1));
      spin = now * 6;
      haloK = 0.5 + open * 0.6;
      if (tt > AB.hit && once('hit')) { emit(18, HOVER, { speed: 1.6, color, color2: 0xffffff, size: 0.03, life: 0.5 }); pulse(HOVER, color, 0.4, 0.45, false); shake.current = 0.35; }
      if (tt > AB.pullFrom && once('pull')) emit(46, HOVER, { speed: 0.4, color: 0xfff1c8, color2: color, size: 0.028, life: 0.6, home: HOVER, spread: 0.75, drag: 0 });
      if (tt > AB.snap && once('snap')) { pulse(HOVER, 0xffffff, 0.5, 0.35, false); shake.current = 0.25; }
    } else if (ph === 'shake') {
      // Cae al pedestal con rebote; después tiembla una vez por cada "casi".
      const drop = DROP_MS / 1000;
      if (tt < drop) {
        const k = tt / drop;
        const fall = k < 0.62 ? ease(k / 0.62) : 1;
        pos.lerpVectors(HOVER, REST, fall);
        // Rebote tras tocar el pedestal.
        if (k >= 0.62) pos.y = REST.y + Math.abs(Math.sin(((k - 0.62) / 0.38) * Math.PI)) * 0.1 * (1 - (k - 0.62) / 0.38);
        squash = k > 0.6 && k < 0.7 ? 0.75 : 1;
        spin = 0;
        if (k > 0.62 && once('land')) { emit(14, REST, { speed: 0.9, up: 0.5, color: 0xd9cfff, size: 0.025, life: 0.45, g: 3 }); pulse(new THREE.Vector3(0, PED_Y + 0.02, REST.z), color, 0.6, 0.6); shake.current = 0.45; }
      } else {
        pos.copy(REST);
        const w = (tt - drop) / (WOBBLE_MS / 1000);
        const cyc = Math.floor(w), local = (w - cyc) * (WOBBLE_MS / 1000);
        const swing = local < SWING_MS / 1000 ? Math.sin((local / (SWING_MS / 1000)) * Math.PI * 2) : 0;
        tiltZ = swing * 0.42;
        pos.x = swing * 0.03;
        spin = 0;
        haloK = 0.4 + Math.abs(swing) * 0.5;
        if (local < 0.05 && once(`w${cyc}`)) { pulse(new THREE.Vector3(0, PED_Y + 0.02, REST.z), color, 0.45, 0.5); shake.current = 0.18; }
      }
    } else if (ph === 'caught') {
      // ¡Clic! Fogonazo dorado, estrellas, onda, y el sello se desvanece mientras sale el profesor.
      pos.copy(REST);
      spin = 0;
      squash = tt < 0.12 ? 0.82 : 1;
      haloK = Math.max(0.3, 1.4 - tt * 1.5);
      visible = tt < 1.1;
      if (tt > 0.85) squash = Math.max(0.0001, 1 - (tt - 0.85) / 0.25);
      if (once('click')) {
        emit(40, REST, { speed: 2.6, up: 1.2, color: 0xffd36b, color2: 0xffffff, size: 0.035, life: 1.1, g: 2.2, drag: 1.6 });
        pulse(new THREE.Vector3(0, PED_Y + 0.02, REST.z), 0xffd36b, 1.1, 0.9);
        pulse(REST, 0xffffff, 0.6, 0.5, false);
        shake.current = 0.6;
      }
      if (tt > 0.85 && once('out')) emit(24, new THREE.Vector3(0, 0, 0.1), { speed: 1.4, up: 0.6, color: 0xffffff, color2: 0xa899ff, size: 0.03, life: 0.7 });
    } else if (ph === 'broke') {
      // Tiembla, se agrieta y revienta en esquirlas del color del sello.
      pos.copy(REST);
      spin = 0;
      tiltZ = tt < 0.28 ? Math.sin(tt * 70) * 0.25 : 0;
      visible = tt < 0.28;
      haloK = 0.6 + Math.sin(tt * 50) * 0.3;
      if (tt > 0.28 && once('burst')) {
        emit(44, REST, { speed: 2.8, up: 0.8, color, color2: 0xff6a5c, size: 0.045, life: 0.9, g: 4, drag: 1 });
        pulse(REST, 0xff6a5c, 0.9, 0.6, false);
        pulse(new THREE.Vector3(0, PED_Y + 0.02, REST.z), color, 0.9, 0.6);
        shake.current = 0.7;
      }
    } else {
      visible = false;
    }

    g.visible = visible;
    g.position.copy(pos);
    g.rotation.set(0, spin, tiltZ);
    g.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    // La tapa: las dos mitades se separan al abrirse.
    sh.children[0].position.y = open * 0.07;
    sh.children[1].position.y = -open * 0.07;
    bd.scale.setScalar(1 + open * 0.7);
    hl.scale.setScalar(2.4 + haloK * 1.4 + Math.sin(now * 8) * 0.08);
    (hl.material as THREE.MeshBasicMaterial).opacity = 0.22 * haloK + 0.08;
    hl.quaternion.copy(camera.quaternion);
    // El haz: un cilindro del sello al profesor.
    bm.visible = beamK > 0.01;
    bm.scale.set(beamK, 1, beamK);
    (bm.material as THREE.MeshBasicMaterial).opacity = beamK * 0.55;

    // La estela del lanzamiento: copias que siguen a la bola con retraso.
    const h = hist.current;
    for (let i = h.length - 1; i > 0; i--) h[i].copy(h[i - 1]);
    h[0].copy(pos);
    trail.current.forEach((m, i) => {
      if (!m) return;
      m.visible = ph === 'throw';
      m.position.copy(h[Math.min(h.length - 1, i + 1)]);
      m.scale.setScalar(SEAL_R * (0.9 - i * 0.14));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.5 - i * 0.08;
    });

    // Sacudida de cámara: decae sola.
    shake.current = Math.max(0, shake.current - dt * 2.2);
    const sk = shake.current * shake.current * 0.06;
    // Un acercamiento lento durante el sellado: la tensión también es encuadre.
    const dolly = ph === 'shake' || ph === 'absorb' ? 0.55 : ph === 'caught' ? 0.3 : 0;
    tmp.set(camHome.x + (Math.random() - 0.5) * sk, camHome.y + (Math.random() - 0.5) * sk - dolly * 0.08, camHome.z - dolly);
    camera.position.lerp(tmp, 1 - Math.exp(-dt * (shake.current > 0.05 ? 30 : 2.5)));
    camera.lookAt(0, LOOK_Y, 0);
  });

  return (
    <group>
      <group ref={grp}>
        <group ref={shell}>
          {/* Mitad superior, del color del sello, y mitad inferior clara: la silueta de un sello de lacre. */}
          <mesh castShadow>
            <sphereGeometry args={[SEAL_R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.35} metalness={0.2} />
          </mesh>
          <mesh castShadow>
            <sphereGeometry args={[SEAL_R, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
            <meshStandardMaterial color={0xf4efe4} roughness={0.4} />
          </mesh>
        </group>
        <mesh ref={band} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[SEAL_R * 1.02, SEAL_R * 0.12, 10, 40]} />
          <meshStandardMaterial color={0x2a2140} emissive={color} emissiveIntensity={0.6} roughness={0.5} />
        </mesh>
        <mesh>
          <sphereGeometry args={[SEAL_R * 0.32, 16, 12]} />
          <meshBasicMaterial color={0xffffff} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={halo}>
        <circleGeometry args={[SEAL_R, 32]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={beam} position={[0, (HOVER.y + 0.05) / 2, HOVER.z / 2]} rotation={[Math.PI / 2 - Math.atan2(HOVER.z, -HOVER.y + 0.05), 0, 0]} visible={false}>
        <cylinderGeometry args={[0.16, 0.32, HOVER.length() + 0.1, 24, 1, true]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} ref={(m) => { trail.current[i] = m; }} visible={false}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshBasicMaterial color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
};

// ---------------------------------------------------------------- aro de enfoque (fase de apuntar)

/** El aro que se encoge y crece alrededor del profesor: lanzar cuando está en la franja dorada. */
const FocusRing: React.FC = () => {
  const ring = useRef<THREE.Mesh>(null);
  const target = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    const r = ring.current, tg = target.current;
    if (!r || !tg) return;
    const aim = clock.phase === 'aim';
    r.visible = aim; tg.visible = aim;
    if (!aim) return;
    const k = live.ringK;
    r.scale.setScalar(0.32 + k * 0.42);
    const good = k < 0.5;
    (r.material as THREE.MeshBasicMaterial).color.setHex(k < 0.3 ? 0xffd36b : good ? 0xa6f0c6 : 0xffffff);
    (r.material as THREE.MeshBasicMaterial).opacity = 0.55 + (good ? 0.35 : 0);
    r.quaternion.copy(camera.quaternion); tg.quaternion.copy(camera.quaternion);
  });
  return (
    <group position={[0, 0.02, 0.25]}>
      <mesh ref={ring}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={target} scale={0.32 * 0.6 + 0.12}>
        <ringGeometry args={[0.97, 1, 64]} />
        <meshBasicMaterial color={0xffd36b} transparent opacity={0.35} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
};

// ---------------------------------------------------------------- escena completa

const Stage: React.FC<{ url: string; talking: boolean; ball: BallKey; phase: Phase }> = ({ url, talking, ball, phase }) => {
  // Reloj de fase compartido por todas las piezas.
  useFrame(() => {
    if (clock.phase !== phase) { clock.phase = phase; clock.t0 = performance.now(); }
    clock.t = (performance.now() - clock.t0) / 1000;
  });
  const key = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const l = key.current;
    if (!l) return;
    const caught = phase === 'caught' ? Math.max(0, 1 - clock.t * 0.7) : 0;
    l.intensity = 3 + caught * 9;
    l.color.setHex(phase === 'broke' ? 0xff8a6a : caught > 0 ? 0xffd36b : 0xffe7c4);
  });
  return (
    <>
      <hemisphereLight args={[0xbfd8ff, 0x3a2140, 1.1]} />
      <directionalLight position={[1.8, 3, 2.6]} intensity={2.1} color={0xfff0d8} castShadow />
      <pointLight ref={key} position={[0, 0.6, 1.4]} intensity={3} distance={6} decay={1.6} />
      <pointLight position={[-1.6, 0.4, -1.2]} intensity={6} distance={5} color={SEAL[ball].hex} />
      <Pedestal color={SEAL[ball].hex} />
      <Suspense fallback={null}>
        <Lecturer url={url} talking={talking} />
      </Suspense>
      <FocusRing />
      <Seal ball={ball} />
      <Rings />
      <Particles />
    </>
  );
};

// ---------------------------------------------------------------- interfaz

export const LectureCapture: React.FC = () => {
  const cap = useCapture();
  const battle = useBattle();
  useT();
  const meter = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState('');

  const spawn = cap.activeId ? spawnById(cap.activeId) : undefined;
  const lesson = cap.activeId ? professorLesson(cap.activeId) : null;
  const teaching = cap.result === 'caught' && !!lesson;
  // La lección no arranca hasta que el profesor ha salido del sello y aterrizado (ver Lecturer, fase caught).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!teaching) { setReady(false); return; }
    const id = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(id);
  }, [teaching]);

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
    if (!ready || !lesson) { setTyped(''); return; }
    setTyped('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(lesson.slice(0, i));
      if (i >= lesson.length) window.clearInterval(id);
    }, 26);
    return () => window.clearInterval(id);
  }, [ready, lesson, cap.activeId]);

  // Espacio/Enter para convencer y Esc para irse ya los atiende CaptureController en el mundo; aquí solo
  // falta cerrar la clase con el teclado cuando el profesor ha terminado de hablar.
  useEffect(() => {
    if (!cap.activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Enter' || e.code === 'Space') && cap.result === 'caught' && ready) { e.preventDefault(); endEncounter(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cap.activeId, cap.phase, cap.result, ready]);

  if (!cap.activeId || battle.active || !spawn) return null;
  const aiming = cap.phase === 'aim';
  const sealing = cap.phase === 'throw' || cap.phase === 'absorb' || cap.phase === 'shake';
  const failed = cap.result === 'fled';
  const seal = SEAL[cap.ball];

  return (
    <div className={`cx ph-${cap.phase}`} style={{ ['--seal' as string]: seal.css }}>
      <div className="cx-sky" />
      <div className="cx-beams" />
      <Canvas
        className="cx-view"
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 0.32, 3.6], fov: 34 }}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ camera }) => camera.lookAt(0, LOOK_Y, 0)}
      >
        <Stage url={spawn.model} talking={teaching && ready} ball={cap.ball} phase={cap.phase} />
      </Canvas>

      {/* Fogonazo de pantalla en los dos momentos de verdad. */}
      {cap.phase === 'caught' && <i className="cx-flash gold" />}
      {cap.phase === 'broke' && <i className="cx-flash red" />}

      <header className="cx-head">
        <small>{t('shop.prof')}</small>
        <h2>{spawn.species.name}</h2>
      </header>

      {cap.phase === 'throw' && cap.qualityLabel && <div className="cx-call" key={`q${cap.qualityLabel}`}>{cap.qualityLabel}</div>}
      {cap.phase === 'caught' && !ready && <div className="cx-stamp ok">{lesson ? '¡Clase desbloqueada!' : '¡Convencido!'}</div>}
      {cap.phase === 'broke' && <div className="cx-stamp ko">¡Se soltó!</div>}

      {teaching && ready && (
        <div className="cx-bubble" key={cap.activeId}>
          <span>{typed}</span><i />
        </div>
      )}

      <div className="cx-dock">
        {aiming && (
          <>
            <p className="cx-tip">{t('shop.focus')}</p>
            <div className="cx-meter" ref={meter}><i /><b /></div>
            <div className="cx-seals">
              {BALL_ORDER.map((k) => (
                <button
                  key={k}
                  className={cap.ball === k ? 'on' : ''}
                  disabled={cap.balls[k] <= 0}
                  onClick={() => selectBall(k)}
                  style={{ ['--c' as string]: SEAL[k].css }}
                >
                  <em />
                  <span>{t(SEAL[k].key)}</span>
                  <strong>×{cap.balls[k]}</strong>
                </button>
              ))}
            </div>
            <div className="cx-acts">
              <button className="go" disabled={cap.balls[cap.ball] <= 0} onClick={() => throwBall()}>
                {t('shop.convince')} <kbd>Espacio</kbd>
              </button>
              <button className="ghost" onClick={runAway}>{t('shop.leave')}</button>
            </div>
            {cap.message && <p className="cx-msg">{cap.message}</p>}
          </>
        )}
        {sealing && <p className="cx-wait">{t('shop.sealing')}<span className="dots"><i /><i /><i /></span></p>}
        {cap.phase === 'broke' && <p className="cx-msg">{cap.message}</p>}
        {teaching && ready && (
          <div className="cx-board">
            <small>{t('shop.board')}</small>
            <p>{typed}</p>
            <button onClick={endEncounter}>{t('shop.ok')} <kbd>Enter</kbd></button>
          </div>
        )}
        {cap.result === 'caught' && !lesson && (
          <div className="cx-board">
            <p>{cap.message}</p>
            <button onClick={endEncounter}>{t('shop.ok')}</button>
          </div>
        )}
        {failed && (
          <div className="cx-board">
            <p>{cap.message}</p>
            <button onClick={endEncounter}>{t('shop.ok')}</button>
          </div>
        )}
      </div>
    </div>
  );
};
