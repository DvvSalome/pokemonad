// El lado 3D del Coliseo Monad: el guardián de la puerta, el neón del recinto y la puesta en escena
// del duelo. La entrada, los golpes y la salida siguen el mismo guion que el combate original
// (BattleArena + battleStore): cortinilla aparte, en la UI; aquí, el vuelo de presentación, la embestida
// en dos tiempos y la cámara que se calla al volver al mundo. La posición real del jugador no se toca:
// el avatar solo se dibuja en su marca (Player.tsx) y, al cerrar, reaparece fuera del portón.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { COLISEUM, COLISEUM_BY_KEY, arenaY, dist, standY } from './terrain';
import { camCtl } from './cameraStore';
import { playerPos } from './wildStore';
import { BOSSES } from '../academy/questions';
import { getAcademy, setNearGuard, setNearTutor, useAcademy } from '../academy/academyStore';
import { ACADEMY, INTRO, LOCAL, MONAD_SITE, fx, stageDt, toWorld, type Body } from './academyStage';
import { ImpactBurst, triggerImpact } from './battle/ImpactBurst';

const GUARD_MODEL = '/monsters/Wizard.glb';
/** Altura del guardián en metros: por encima del jugador, para que imponga sin tapar el portón. */
const GUARD_HEIGHT = 3.2;
/** A esta distancia del guardián se puede hablar con él. */
const TALK_RANGE = 7;
/** Carga del golpe, en segundos. Igual que WIND_MS del store: el impacto llega cuando la tienda lo dice. */
const WIND = 0.64;

const site = () => COLISEUM_BY_KEY[MONAD_SITE];

/** Dónde vigila el guardián, en coordenadas locales (−x es el portón). Las marcas del duelo viven en academyStage. */
const GUARD_SPOT = [-(COLISEUM.wall + COLISEUM.wallT + 4), 0] as const;

/**
 * Los tres tutores, fuera del muro y delante del portón. El orden es el del temario: el principiante
 * a un lado del camino, el intermedio al otro y el avanzado un poco más allá, para que se recorran.
 */
const TUTOR_SPOTS: { id: number; lx: number; lz: number }[] = [
  { id: 0, lx: -(COLISEUM.wall + 11), lz: -15 },
  { id: 1, lx: -(COLISEUM.wall + 15), lz: 7 },
  { id: 2, lx: -(COLISEUM.wall + 5), lz: 18 },
];

export const guardPosition = (): [number, number] => toWorld(GUARD_SPOT[0], GUARD_SPOT[1]);

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const findClip = (clips: THREE.AnimationClip[], re: RegExp) => clips.find((c) => re.test(c.name)) ?? null;

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _bolt = new THREE.Vector3();

/** Un punto en coordenadas locales del recinto (y = altura sobre la pista) llevado al mundo. */
function worldAt(lx: number, y: number, lz: number, out: THREE.Vector3) {
  const [x, z] = toWorld(lx, lz);
  return out.set(x, arenaY(site()) + y, z);
}

function spring(body: Body, dt: number) {
  body.knockV -= body.knock * 60 * dt;
  body.knockV *= Math.exp(-9 * dt);
  body.knock += body.knockV * dt;
}

/** Embestida del atacante: impulso atrás, se lanza hasta casi tocar al rival y vuelve. `t` incluye el wind. */
function lungeOf(t: number, gap: number) {
  if (t < 0.18) return -0.35 * ease(t / 0.18);
  if (t < WIND) return -0.35 + (gap + 0.35) * ease((t - 0.18) / (WIND - 0.18));
  return gap * (1 - ease(clamp01((t - WIND) / 0.42)));
}

// ---------------------------------------------------------------- el guardián de la puerta

const Guard: React.FC = () => {
  const { scene, animations } = useGLTF(GUARD_MODEL);
  const group = useRef<THREE.Group>(null);
  const a = useAcademy();

  const { model, scale, lift } = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = false;
      // frustumCulled OFF: estos modelos vienen con la geometría en bind pose de unos pocos centímetros
      // y es el esqueleto el que la agranda, así que su esfera de recorte mide 3 cm. three recortaría el
      // monstruo entero en cuanto esa esfera saliera del encuadre — y el monstruo, que sí se ve, no.
      m.frustumCulled = false;
    });
    // updateMatrixWorld ANTES de medir: en un clon recién hecho las matrices de mundo están sin
    // actualizar y Box3.setFromObject devuelve una caja en el espacio equivocado. Medir mal aquí es lo
    // que deja al modelo del tamaño de una mota (ver Monsters.tsx, que hace exactamente esto).
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const h = Math.max(1e-3, box.max.y - box.min.y);
    const k = GUARD_HEIGHT / h;
    return { model: clone, scale: k, lift: -box.min.y * k };
  }, [scene]);

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  useEffect(() => {
    const idle = animations.find((c) => /idle/i.test(c.name)) ?? animations[0];
    if (idle) mixer.clipAction(idle).reset().play();
    return () => { mixer.stopAllAction(); };
  }, [animations, mixer]);

  const [gx, gz] = useMemo(() => guardPosition(), []);
  const y = arenaY(site());

  useFrame((_, dt) => {
    mixer.update(Math.min(dt, 0.05));
    const g = group.current;
    if (!g) return;
    // Mira siempre al jugador cuando lo tiene cerca; si no, vigila el portón.
    const dx = playerPos.x - gx, dz = playerPos.z - gz;
    const d = Math.hypot(dx, dz);
    const look = d < 22 ? Math.atan2(dx, dz) : site().rot - Math.PI / 2;
    g.rotation.y += (look - g.rotation.y) * Math.min(1, dt * 4);
    g.position.y = y + lift + Math.sin(performance.now() / 900) * 0.06;
    setNearGuard(d < TALK_RANGE && getAcademy().phase === 'closed');
  });

  return (
    <group ref={group} position={[gx, y + lift, gz]} scale={scale}>
      <primitive object={model} />
      {/* Sello de acceso en el suelo: el morado de Monad marcando dónde hay que pararse. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.9, 1.25, 48]} />
        <meshBasicMaterial color={a.verified ? 0x39e6a8 : 0x836ef9} transparent opacity={0.65} depthWrite={false} />
      </mesh>
      <pointLight color={0x836ef9} intensity={6} distance={14} decay={1.6} position={[0, 1.6, 0]} />
    </group>
  );
};

// ---------------------------------------------------------------- tutores de la explanada

BOSSES.forEach((b) => useGLTF.preload(b.model));

/** Un jefe del temario, plantado en el mundo. Hablarle entra directo a su pelea. */
const Tutor: React.FC<{ id: number; x: number; z: number }> = ({ id, x, z }) => {
  const boss = BOSSES[id];
  const { scene, animations } = useGLTF(boss.model);
  const group = useRef<THREE.Group>(null);
  const height = Math.min(2.7, boss.height * 0.7);

  const { model, scale, lift } = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false;
    });
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const h = Math.max(1e-3, box.max.y - box.min.y);
    const k = height / h;
    return { model: clone, scale: k, lift: -box.min.y * k };
  }, [scene, height]);

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  useEffect(() => {
    const idle = animations.find((c) => /idle/i.test(c.name)) ?? animations[0];
    if (idle) mixer.clipAction(idle).reset().play();
    return () => { mixer.stopAllAction(); };
  }, [animations, mixer]);

  const y = standY(x, z);
  useFrame((_, dt) => {
    mixer.update(Math.min(dt, 0.05));
    const g = group.current;
    if (!g) return;
    const dx = playerPos.x - x, dz = playerPos.z - z;
    const d = Math.hypot(dx, dz);
    const look = d < 18 ? Math.atan2(dx, dz) : Math.atan2(site().x - x, site().z - z);
    g.rotation.y += (look - g.rotation.y) * Math.min(1, dt * 4);
    g.position.y = lift + Math.sin(performance.now() / 800 + id) * 0.05;
  });

  const color = `#${boss.color.toString(16).padStart(6, '0')}`;
  return (
    <group position={[x, y, z]}>
      <group ref={group} position={[0, lift, 0]} scale={scale}>
        <primitive object={model} />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.85, 1.15, 40]} />
        <meshBasicMaterial color={boss.color} transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <pointLight color={boss.color} intensity={5} distance={12} decay={1.6} position={[0, 2.2, 0]} />
      <Html position={[0, height + 0.45, 0]} center distanceFactor={16} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className="mon-tutor-tag" style={{ ['--tc' as string]: color }}>
          <small>{boss.level}</small>
          <b>{boss.name}</b>
        </div>
      </Html>
    </group>
  );
};

/** Los tres tutores y quién está a distancia de hablar. */
const Tutors: React.FC = () => {
  const spots = useMemo(() => TUTOR_SPOTS.map((s) => {
    const [x, z] = toWorld(s.lx, s.lz);
    return { id: s.id, x, z };
  }), []);

  useEffect(() => () => setNearTutor(null), []);

  useFrame(() => {
    if (getAcademy().phase !== 'closed') {
      setNearTutor(null);
      return;
    }
    let best: number | null = null;
    let bestD = TALK_RANGE;
    for (const s of spots) {
      const d = Math.hypot(playerPos.x - s.x, playerPos.z - s.z);
      if (d < bestD) { bestD = d; best = s.id; }
    }
    setNearTutor(best);
  });

  return (
    <group>
      {spots.map((s) => <Tutor key={s.id} id={s.id} x={s.x} z={s.z} />)}
    </group>
  );
};

// ---------------------------------------------------------------- el neón del recinto

const NeonRing: React.FC = () => {
  const s = site();
  const y = arenaY(s);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current?.material as THREE.MeshBasicMaterial | undefined;
    if (m) m.opacity = 0.35 + Math.sin(clock.elapsedTime * 1.6) * 0.12;
  });
  return (
    <group position={[s.x, y, s.z]}>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[COLISEUM.floor - 1.4, COLISEUM.floor - 0.5, 96]} />
        <meshBasicMaterial color={0x836ef9} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[COLISEUM.floor * 0.33, COLISEUM.floor * 0.36, 72]} />
        <meshBasicMaterial color={0xa899ff} transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <pointLight color={0x7a5cff} intensity={28} distance={COLISEUM.wall * 2.4} decay={1.4} position={[0, 10, 0]} />
    </group>
  );
};

// ---------------------------------------------------------------- reloj del duelo

/** Avanza el tiempo de la arena (pausa de impacto y cámara lenta) y escribe embestida, pose y retroceso. */
const DuelClock: React.FC = () => {
  const phase = useRef({ id: 0, name: '', t: 0 });
  const gap = useMemo(() => {
    const dx = LOCAL.boss[0] - LOCAL.player[0];
    const dz = LOCAL.boss[1] - LOCAL.player[1];
    return Math.max(1.6, Math.hypot(dx, dz) - 2.6);
  }, []);

  useFrame((_, dtRaw) => {
    const dtReal = Math.min(dtRaw, 0.05);
    if (fx.freeze > 0) { fx.freeze -= dtReal; fx.speed = 0.03; }
    else if (fx.slow > 0) {
      fx.slow = Math.max(0, fx.slow - dtReal);
      fx.speed = fx.slow > 0.4 ? 0.22 : 1 - 0.78 * (fx.slow / 0.4);
    } else fx.speed = 1;
    const dt = stageDt(dtRaw);
    fx.t += dt;

    const b = getAcademy().battle;
    const a = b?.anim ?? null;
    const P = phase.current;
    if (a && (a.id !== P.id || a.phase !== P.name)) {
      P.id = a.id; P.name = a.phase; P.t = 0;
      if (a.phase === 'impact') {
        const body = a.by === 'player' ? fx.boss : fx.player;
        body.knockV = a.ko ? 10 : 6;
        const recv = a.by === 'player' ? ACADEMY.boss : ACADEMY.player;
        const h = a.by === 'player' ? fx.height.boss : fx.height.player;
        const color = a.by === 'player' ? 0xa899ff : (b?.boss.color ?? 0x836ef9);
        triggerImpact(_tmp.set(recv.x, recv.y + h * 0.55, recv.z), color, 0xfff1d6, a.ko ? 1.7 : 1.15, a.ko);
      }
    }
    if (a) P.t += dt;
    fx.animId = a?.id ?? 0;
    fx.animT = a ? P.t : 0;

    const tHit = a ? (a.phase === 'wind' ? P.t : WIND + P.t) : 0;
    fx.player.lunge = a?.by === 'player' ? lungeOf(tHit, gap) : 0;
    fx.boss.lunge = a?.by === 'boss' ? lungeOf(tHit, gap) : 0;
    spring(fx.player, dt);
    spring(fx.boss, dt);

    if (!b) fx.pose = 'idle';
    else if (b.turn === 'over') fx.pose = b.win ? 'win' : 'lose';
    else if (a?.by === 'player') fx.pose = 'attack';
    else if (a?.by === 'boss' && a.phase === 'impact') fx.pose = 'hurt';
    else fx.pose = 'idle';
  });
  return <ImpactBurst />;
};

// ---------------------------------------------------------------- el jefe

const BossFighter: React.FC<{ bossKey: string }> = ({ bossKey }) => {
  const boss = useMemo(() => BOSSES.find((b) => b.key === bossKey) ?? BOSSES[0], [bossKey]);
  const { scene, animations } = useGLTF(boss.model);
  const group = useRef<THREE.Group>(null);
  const aura = useRef<THREE.Mesh>(null);
  const played = useRef({ wind: 0, impact: 0, over: false, down: 0 });

  const model = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    const mats: THREE.MeshStandardMaterial[] = [];
    let scale = 1, lift = 0;
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const copy = mat.clone();
      copy.emissive = new THREE.Color(boss.color);
      copy.emissiveIntensity = 0;
      m.material = copy;
      mats.push(copy);
    });
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const h = Math.max(1e-3, box.max.y - box.min.y);
    scale = boss.height / h;
    lift = -box.min.y * scale;
    return { clone, mats, scale, lift };
  }, [scene, boss.color, boss.height]);

  const anim = useMemo(() => {
    const mixer = new THREE.AnimationMixer(model.clone);
    const act = (re: RegExp) => {
      const clip = findClip(animations, re);
      return clip ? mixer.clipAction(clip) : null;
    };
    const idle = act(/idle/i) ?? (animations[0] ? mixer.clipAction(animations[0]) : null);
    const a = { mixer, idle, attack: act(/attack|punch|bite|slash|shoot/i), hit: act(/hit|hurt|react/i), death: act(/death|die/i) };
    idle?.reset().play();
    return a;
  }, [animations, model]);

  const current = useRef<THREE.AnimationAction | null>(null);
  const play = (next: THREE.AnimationAction | null, fade = 0.12, replay = false) => {
    if (!next) return;
    if (next === current.current && !replay) return;
    next.reset().fadeIn(fade).play();
    if (current.current && current.current !== next) current.current.crossFadeTo(next, fade, false);
    current.current = next;
  };

  useFrame((_, dtRaw) => {
    const dt = stageDt(dtRaw);
    anim.mixer.update(dt);
    const g = group.current;
    if (!g) return;
    const b = getAcademy().battle;
    const shown = fx.t >= INTRO.bossAt;
    g.visible = shown;
    if (!shown) return;

    const pop = Math.min(1, (fx.t - INTRO.bossAt) * 3.2);
    const popK = pop < 1 ? 0.15 + pop * 0.85 + Math.sin(pop * Math.PI) * 0.12 : 1;
    const lost = b?.turn === 'over' && !!b.win;
    played.current.down = lost ? Math.min(1, played.current.down + dt * 0.55) : 0;

    const a = b?.anim ?? null;
    if (a && a.phase === 'wind' && a.by === 'boss' && a.id !== played.current.wind) {
      played.current.wind = a.id;
      play(anim.attack ?? anim.idle, 0.08, true);
    }
    if (a && a.phase === 'impact' && a.by === 'player' && a.id !== played.current.impact) {
      played.current.impact = a.id;
      play(anim.hit ?? anim.idle, 0.05, true);
    }
    if (b?.turn === 'over' && !played.current.over) {
      played.current.over = true;
      play(b.win ? (anim.death ?? anim.idle) : anim.idle, 0.12, true);
    }
    if (b?.turn !== 'over') played.current.over = false;
    if (!a && b?.turn !== 'over') play(anim.idle, 0.2);

    const face = Math.atan2(ACADEMY.player.x - ACADEMY.boss.x, ACADEMY.player.z - ACADEMY.boss.z);
    const off = fx.boss.lunge - fx.boss.knock;
    const sink = lost && !anim.death ? ease(clamp01((played.current.down - 0.35) / 0.65)) : 0;
    g.position.set(
      ACADEMY.boss.x + Math.sin(face) * off,
      ACADEMY.boss.y + model.lift + Math.sin(fx.t * 2.1) * 0.08 * (1 - sink) - sink * 0.4,
      ACADEMY.boss.z + Math.cos(face) * off,
    );
    g.rotation.y = face;
    g.rotation.z = lost && !anim.death ? -ease(clamp01(played.current.down * 1.4)) * 1.15 : 0;
    g.scale.setScalar(model.scale * popK * (1 - sink * 0.15));

    const hurt = a?.by === 'player' && a.phase === 'impact' ? 1 : 0;
    for (const m of model.mats) m.emissiveIntensity = hurt * 2.2 + 0.12;
    const ring = aura.current;
    if (ring) {
      const s = 1 + Math.sin(fx.t * 3) * 0.04 + hurt * 0.45;
      ring.scale.setScalar(s);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.22 + hurt * 0.4;
    }
  });

  return (
    <group>
      <group ref={group} visible={false}>
        <primitive object={model.clone} />
      </group>
      <mesh ref={aura} position={[ACADEMY.boss.x, ACADEMY.boss.y + 0.04, ACADEMY.boss.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6, 2.6, 48]} />
        <meshBasicMaterial color={boss.color} transparent opacity={0.25} depthWrite={false} />
      </mesh>
      <pointLight color={boss.color} intensity={14} distance={22} decay={1.5} position={[ACADEMY.boss.x, ACADEMY.boss.y + 3, ACADEMY.boss.z]} />
    </group>
  );
};

/** El proyectil del turno: viaja durante la carga y desaparece al impactar (el estallido lo pone ImpactBurst). */
const Bolt: React.FC = () => {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const b = getAcademy().battle;
    const a = b?.anim;
    const live = !!a && a.phase === 'wind';
    mesh.visible = live;
    if (!live || !a) return;
    const k = clamp01(fx.animT / WIND);
    const from = a.by === 'player' ? ACADEMY.player : ACADEMY.boss;
    const to = a.by === 'player' ? ACADEMY.boss : ACADEMY.player;
    const h0 = a.by === 'player' ? fx.height.player * 0.7 : fx.height.boss * 0.55;
    const h1 = a.by === 'player' ? fx.height.boss * 0.55 : fx.height.player * 0.7;
    _bolt.set(
      THREE.MathUtils.lerp(from.x, to.x, k),
      THREE.MathUtils.lerp(from.y + h0, to.y + h1, k),
      THREE.MathUtils.lerp(from.z, to.z, k),
    );
    mesh.position.copy(_bolt);
    mesh.scale.setScalar(0.55 + k * 1.4);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(a.by === 'player' ? 0xa899ff : (b?.boss.color ?? 0xff5d6c));
    mat.opacity = 0.95 - k * 0.25;
  });
  return (
    <mesh ref={ref} visible={false}>
      <sphereGeometry args={[0.42, 16, 12]} />
      <meshBasicMaterial color={0xa899ff} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
};

// ---------------------------------------------------------------- cámara del duelo

/** Plano deseado. Los desplazamientos van en coordenadas locales del recinto, así el giro de la sede no tumba el encuadre. */
function shot(t: number, outPos: THREE.Vector3, outLook: THREE.Vector3): 'cut' | 'smooth' {
  const b = getAcademy().battle;
  const P = LOCAL.player, B = LOCAL.boss;
  const hP = fx.height.player, hB = fx.height.boss;
  const midX = (P[0] + B[0]) / 2, midZ = (P[1] + B[1]) / 2;
  if (b?.turn === 'intro') {
    if (t < INTRO.dollyAt) {
      const k = ease(clamp01(t / INTRO.dollyAt));
      const ang = -Math.PI / 2 + (1.05 - k * 0.75);
      const r = 24 - k * 8;
      worldAt(Math.cos(ang) * r, 16 - k * 9, Math.sin(ang) * r, outPos);
      worldAt(-k * 1.2, 1.4, 0, outLook);
      return t < 0.05 ? 'cut' : 'smooth';
    }
    if (t < INTRO.playerAt) {
      const k = ease(clamp01((t - INTRO.dollyAt) / (INTRO.playerAt - INTRO.dollyAt)));
      worldAt(B[0] + (4.4 - k * 1.5), 1.0 + hB * 0.25 + k * 0.4, B[1] - 6.2 + k * 1.5, outPos);
      worldAt(B[0], hB * 0.55, B[1], outLook);
      return t < INTRO.dollyAt + 0.05 ? 'cut' : 'smooth';
    }
    if (t < INTRO.playerAt + 0.7) {
      worldAt(P[0] - 1.8, 2.2, P[1] - 3.4, outPos);
      worldAt(P[0], 1.15, P[1], outLook);
      return t < INTRO.playerAt + 0.05 ? 'cut' : 'smooth';
    }
  }
  if (b?.turn === 'over') {
    const win = !!b.win;
    const W = win ? P : B;
    const h = win ? hP : hB;
    const ang = -Math.PI / 2 + Math.sin(t * 0.25) * 0.45;
    const r = 4.4 + h * 0.6;
    worldAt(W[0] + Math.cos(ang) * r, 1.35 + h * 0.35, W[1] + Math.sin(ang) * r, outPos);
    worldAt(W[0], h * 0.5, W[1], outLook);
    return 'smooth';
  }
  const a = b?.anim;
  if (a && a.ko && a.phase === 'impact') {
    const foe = a.by === 'player';
    const T = foe ? B : P;
    const h = foe ? hB : hP;
    const push = clamp01(1 - fx.slow / 1.5);
    worldAt(T[0] + 1.2, 0.7 + h * 0.3, T[1] - (4.6 + h * 0.3 - push * 0.8), outPos);
    worldAt(T[0], h * 0.48, T[1], outLook);
    return 'cut';
  }
  if (a?.by === 'player') {
    worldAt(P[0] - 2.6, 1.7 + hP * 0.35, P[1] - 3.6, outPos);
    worldAt(B[0], hB * 0.5, B[1], outLook);
    return 'smooth';
  }
  if (a?.by === 'boss') {
    worldAt(B[0] + 2.8, 1.9 + hB * 0.25, B[1] - 3.8, outPos);
    worldAt(P[0], hP * 0.55, P[1], outLook);
    return 'smooth';
  }
  // Plano general, el mismo encuadre que el estadio original: el jugador más cerca, el jefe al fondo.
  // 11 m atrás cabe un jefe de ~3 m con FOV 38 sin perder al jugador en el centro de la pista.
  const sway = Math.sin(t * 0.35) * 0.5;
  worldAt(midX + (P[0] - midX) * 0.55 + sway, 3.1, midZ - 11, outPos);
  worldAt(midX, 1.35, midZ, outLook);
  return 'smooth';
}

/** Mientras la arena está activa esta cámara manda; al cerrar no toca `camCtl.cut`, para que CameraRig recupere al jugador fuera del portón. */
const DuelCamera: React.FC = () => {
  const { camera } = useThree();
  const lookNow = useRef(new THREE.Vector3());
  const lastCutKey = useRef('');
  const baseFov = useRef(0);
  useFrame((_, dtRaw) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!ACADEMY.active) {
      if (baseFov.current) { cam.fov = baseFov.current; cam.updateProjectionMatrix(); baseFov.current = 0; }
      return;
    }
    const dt = Math.min(dtRaw, 0.05);
    if (!baseFov.current) baseFov.current = cam.fov;
    fx.kick = Math.max(0, fx.kick - dt * 2.4);
    const fov = baseFov.current * (1 - 0.12 * fx.kick * fx.kick);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const b = getAcademy().battle;
    const mode = shot(fx.t, _pos, _look);
    const an = b?.anim;
    const key = an?.ko && an.phase === 'impact'
      ? `ko${an.id}`
      : `${b?.turn ?? ''}:${fx.t < INTRO.dollyAt ? 0 : fx.t < INTRO.playerAt ? 1 : fx.t < INTRO.playerAt + 0.7 ? 2 : 3}`;
    if (camCtl.cut || (mode === 'cut' && key !== lastCutKey.current)) {
      camCtl.cut = false;
      lastCutKey.current = key;
      camera.position.copy(_pos);
      lookNow.current.copy(_look);
    } else {
      camera.position.lerp(_pos, 1 - Math.exp(-dt * 3.2));
      lookNow.current.lerp(_look, 1 - Math.exp(-dt * 4.5));
    }
    fx.shake = Math.max(0, fx.shake - dt * 1.4);
    const sh = fx.shake * fx.shake;
    _tmp.set((Math.random() - 0.5) * sh * 0.8, (Math.random() - 0.5) * sh * 0.8, (Math.random() - 0.5) * sh * 0.8);
    camera.position.add(_tmp);
    camera.lookAt(lookNow.current);
  });
  return null;
};

// ---------------------------------------------------------------- efectos del golpe (anillos, cifra, confeti)

const CONFETTI = [0xffd84a, 0x836ef9, 0xa899ff, 0x39e6a8, 0xff5d6c, 0xffffff];

/** Lo que el estadio original enseña en cada golpe, traducido al duelo: aros, cifra flotante y confeti. */
const DuelFx: React.FC = () => {
  const a = useAcademy();
  const rings = useRef<THREE.Mesh[]>([]);
  const bits = useRef<THREE.Mesh[]>([]);
  const st = useRef({ id: 0, phase: '', ringT: [9, 9, 9], conf: -1 });
  const anim = a.battle?.anim ?? null;
  const win = a.battle?.turn === 'over' && !!a.battle.win;

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const b = getAcademy().battle;
    const hit = b?.anim;
    const S = st.current;
    if (hit && (hit.id !== S.id || hit.phase !== S.phase)) {
      S.id = hit.id;
      S.phase = hit.phase;
      if (hit.phase === 'impact') {
        const recv = hit.by === 'player' ? ACADEMY.boss : ACADEMY.player;
        const color = hit.ok ? 0xa899ff : (b?.boss.color ?? 0xff5d6c);
        rings.current.forEach((m, i) => {
          if (!m) return;
          S.ringT[i] = -i * 0.07;
          m.position.set(recv.x, recv.y + 0.2, recv.z);
          (m.material as THREE.MeshBasicMaterial).color.setHex(color);
        });
      }
    }
    rings.current.forEach((m, i) => {
      if (!m) return;
      S.ringT[i] += dt;
      const k = S.ringT[i];
      const live = k >= 0 && k < 0.55;
      m.visible = live;
      if (!live) return;
      const e = k / 0.55;
      m.scale.setScalar(1.2 + e * (i === 0 ? 7 : 4.5));
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - e) * 0.85;
    });

    if (b?.turn === 'over' && b.win) {
      if (S.conf < 0) S.conf = 0;
      S.conf += dt;
    } else S.conf = -1;
    bits.current.forEach((m, i) => {
      if (!m) return;
      const live = S.conf >= 0 && S.conf < 2.4;
      m.visible = live;
      if (!live) return;
      const seed = (k: number) => ((Math.sin(i * 12.9 + k * 7.1) * 43758.5) % 1 + 1) % 1;
      const x = (seed(1) - 0.5) * 10;
      const z = (seed(2) - 0.5) * 8;
      m.position.set(ACADEMY.center.x + x, ACADEMY.player.y + 6 - S.conf * (2.2 + seed(3) * 2) + Math.sin(S.conf * 6 + i) * 0.3, ACADEMY.center.z + z);
      m.rotation.z = S.conf * (2 + seed(4) * 4);
    });
  });

  const recv = anim?.by === 'player' ? ACADEMY.boss : ACADEMY.player;
  const h = anim?.by === 'player' ? fx.height.boss : fx.height.player;
  const showNum = anim?.phase === 'impact';

  return (
    <group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { if (m) rings.current[i] = m; }} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.55, 0.72, 40]} />
          <meshBasicMaterial color={0xa899ff} transparent opacity={0.8} depthWrite={false} />
        </mesh>
      ))}
      {showNum && recv && (
        <Html position={[recv.x, recv.y + h + 0.55, recv.z]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`mon-pop ${anim?.ok ? 'ok' : 'ko'}`}><b>-1</b><small>{anim?.ok ? 'CERTERO' : 'FALLO'}</small></div>
        </Html>
      )}
      {win && CONFETTI.concat(CONFETTI, CONFETTI, CONFETTI).map((c, i) => (
        <mesh key={i} ref={(m) => { if (m) bits.current[i] = m; }} visible={false}>
          <planeGeometry args={[0.16, 0.28]} />
          <meshBasicMaterial color={c} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
};

// ---------------------------------------------------------------- montaje

/** Cerca de la sede de Monad. Se actualiza al cruzar el umbral: la posición del jugador no provoca renders. */
function useNearPlaza() {
  const [near, setNear] = useState(false);
  useFrame(() => {
    const next = dist(playerPos.x, playerPos.z, site()) < COLISEUM.wall * 6;
    setNear((cur) => (cur === next ? cur : next));
  });
  return near;
}

export const AcademyArena: React.FC = () => {
  const a = useAcademy();
  const nearPlaza = useNearPlaza();

  // Si el jugador se aleja del coliseo, el guardián deja de estar "cerca" aunque no haya frame.
  useEffect(() => {
    if (a.phase !== 'closed') setNearGuard(false);
  }, [a.phase]);

  const live = a.view === 'arena' && !!fx.bossKey;

  return (
    <group>
      <NeonRing />
      {nearPlaza && !live && <Guard />}
      {nearPlaza && !live && <Tutors />}
      <DuelCamera />
      {live && (
        <>
          <DuelClock />
          <BossFighter bossKey={fx.bossKey!} />
          <Bolt />
          <DuelFx />
        </>
      )}
    </group>
  );
};

useGLTF.preload(GUARD_MODEL);
