// Monstruos salvajes: carga los GLB del pack Ultimate Monsters (CC0), los pasa por el mismo cel-shading
// que el resto del mundo (toonifyObject) y los planta en las manchas de spawn de su zona con su animación
// de reposo. Como en research/pokegrass-source/js/creature.js, el de un token va pintado con los colores
// de su logo y lleva su moneda girando sobre la cabeza; etapa 3 y shinies llevan aura; y los Rare/Epic
// solo se dejan ver de cerca (o con el Rare Radar). Durante un encuentro, el monstruo activo alimenta cada
// frame su posición en pantalla (para el aro) y de mundo (para la bola), y se "absorbe" al meterlo en la bola.
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { toonifyObject } from './toon';
import { SPAWNS as DEMO_SPAWNS, surfaceY, type Spawn } from './species';
import { useCapture, live } from './captureStore';
import { useWild, playerPos } from './wildStore';
import { useBuffs, isShiny, radarOn } from './buffs';
import { inArena } from './battleStore';
import { capFx } from './capture/fxState';
import {
  paletteFor, naturalPalette, shinyPalette, applyPalette, logoTexture, ringTexture, dotTexture,
} from './tokenLook';

/** Elige la animación de reposo: Flying_Idle para voladores, Idle para el resto, con caídas sensatas. */
export function pickIdle(animations: THREE.AnimationClip[], flying: boolean): THREE.AnimationClip | null {
  if (!animations.length) return null;
  const find = (re: RegExp) => animations.find((a) => re.test(a.name));
  // Peces del pack de Quaternius: Swimming_Normal; la avispa solo trae Wasp_Flying.
  if (flying) return find(/Flying_Idle/i) || find(/Idle/i) || find(/Fast_Flying/i) || find(/Swimming_Normal/i) || find(/Flying/i) || animations[0];
  return find(/(^|\|)Idle$/i) || find(/Idle/i) || find(/Swimming_Normal/i) || animations[0];
}

/** A cuántos metros se deja ver una especie escondida (world.js del original). */
const SEE: Partial<Record<string, number>> = { Rare: 34, Epic: 16 };

const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _white = new THREE.Color(0xffffff);

interface Glowable { mat: THREE.MeshToonMaterial; emissive: THREE.Color; color: THREE.Color; rim?: { rim: { value: number }; rimColor: { value: THREE.Color } }; rim0: number }

/** La moneda del token: canto metálico y el logo en ambas caras, girando y flotando. */
const TokenCoin: React.FC<{ logo?: string; symbol: string; shiny: boolean; y: number }> = ({ logo, symbol, shiny, y }) => {
  const holder = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * 10);
  const r = 0.34;
  const { geo, mats } = useMemo(() => {
    const g = new THREE.CylinderGeometry(r, r, r * 0.16, 40);
    const rim = new THREE.MeshStandardMaterial({ color: 0xf1f4f8, metalness: 0.9, roughness: 0.25 });
    const face = new THREE.MeshBasicMaterial({ color: 0xffffff });
    return { geo: g, mats: [rim, face, face] as THREE.Material[] };
  }, []);
  useEffect(() => {
    let alive = true;
    const face = mats[1] as THREE.MeshBasicMaterial;
    logoTexture(logo, symbol, shiny ? '#ffe3fb' : '#ffffff').then((tex) => {
      if (!alive) return;
      face.map = tex; face.needsUpdate = true;
    });
    return () => { alive = false; };
  }, [logo, symbol, shiny, mats]);
  useEffect(() => () => { geo.dispose(); mats.forEach((m) => m.dispose()); }, [geo, mats]);
  useFrame((_, dt) => {
    const h = holder.current;
    if (!h) return;
    phase.current += dt;
    h.rotation.y += dt * 1.6;
    h.position.y = y + Math.sin(phase.current * 2.2) * 0.06;
  });
  return (
    <group ref={holder} position={[0, y, 0]}>
      <mesh geometry={geo} material={mats} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
};

/** Aro suave en el suelo y chispas que suben (etapa 3 en cian, shiny en rosa). */
const Aura: React.FC<{ color: number; height: number; strength: number }> = ({ color, height, strength }) => {
  const N = 40;
  const { geo, seed, ringMat, dotMat } = useMemo(() => {
    const pos = new Float32Array(N * 3), sd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.9;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * height * 1.2; pos[i * 3 + 2] = Math.sin(a) * r;
      sd[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 * strength, depthWrite: false, blending: THREE.AdditiveBlending, map: ringTexture() });
    const dm = new THREE.PointsMaterial({ color, size: 0.11, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, map: dotTexture(), sizeAttenuation: true });
    return { geo: g, seed: sd, ringMat: rm, dotMat: dm };
  }, [color, height, strength]);
  useEffect(() => () => { geo.dispose(); ringMat.dispose(); dotMat.dispose(); }, [geo, ringMat, dotMat]);
  const ring = useRef<THREE.Mesh>(null);
  const clock = useRef(0);
  useFrame((_, dt) => {
    clock.current += dt;
    const a = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < N; i++) { a[i * 3 + 1] += dt * (0.35 + seed[i] * 0.5); if (a[i * 3 + 1] > height * 1.3) a[i * 3 + 1] = 0; }
    geo.attributes.position.needsUpdate = true;
    ringMat.opacity = (0.28 + Math.sin(clock.current * 2) * 0.08) * strength;
    if (ring.current) ring.current.rotation.z += dt * 0.3;
  });
  return (
    <group>
      <mesh ref={ring} material={ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <planeGeometry args={[3, 3]} />
      </mesh>
      <points geometry={geo} material={dotMat} />
    </group>
  );
};

/** Columna de luz del Rare Radar sobre un Rare/Epic: se ve desde lejos. */
const RadarBeam: React.FC<{ epic: boolean; from: number }> = ({ epic, from }) => (
  <mesh position={[0, from + 8, 0]} renderOrder={2}>
    <cylinderGeometry args={[0.22, 0.12, 16, 16, 1, true]} />
    <meshBasicMaterial color={epic ? 0xc38cff : 0x7fd8ff} transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
  </mesh>
);

const MonsterView: React.FC<{ spawn: Spawn }> = ({ spawn }) => {
  const { scene, animations } = useGLTF(spawn.model);
  const { camera, size: viewport } = useThree();
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const bobPhase = useRef(Math.random() * Math.PI * 2);
  const vis = useRef(0);
  const revealed = useRef(false);
  const glowMats = useRef<Glowable[]>([]);
  const outlines = useRef<THREE.Object3D[]>([]);
  const annoyClock = useRef(0);

  const cap = useCapture();
  const buffs = useBuffs();
  const active = cap.activeId === spawn.id;
  // En pleno encuentro manda lo que se fijó al empezar; fuera, la suerte del momento (con o sin Charm).
  const shiny = active ? cap.shiny : isShiny(spawn.id); // eslint-disable-line react-hooks/exhaustive-deps
  const stage = spawn.stage ?? 1;
  const see = SEE[spawn.species.tier];
  const radar = buffs.radar > Date.now();

  // Clonar (esqueleto incluido), cel-shar y medir para escalar a la altura objetivo. Una sola vez por modelo.
  const { root, scale, lift } = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    toonifyObject(cloned, { outline: 0.02, rim: 0.14 });
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const h = Math.max(1e-3, box.max.y - box.min.y);
    const mats: Glowable[] = [];
    const lines: THREE.Object3D[] = [];
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.userData.isOutline) lines.push(m);
      else if (m.isMesh) {
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) {
          const tm = mat as THREE.MeshToonMaterial;
          if (!tm.emissive) continue;
          const rim = tm.userData.rimUniforms as Glowable['rim'];
          mats.push({ mat: tm, emissive: tm.emissive.clone(), color: tm.color.clone(), rim, rim0: rim?.rim.value ?? 0 });
        }
      }
    });
    glowMats.current = mats;
    outlines.current = lines;
    return { root: cloned, scale: spawn.size / h, lift: -box.min.y };
  }, [scene, spawn.size]);

  // Colores: los del logo del token (girados si es shiny); sin token, los propios (girados si es shiny).
  const logo = spawn.token?.logo, symbol = spawn.token?.symbol;
  useEffect(() => {
    let alive = true;
    (async () => {
      const pal = symbol ? await paletteFor(logo, symbol) : shiny ? naturalPalette(root) : null;
      if (!alive) return;
      applyPalette(root, pal && shiny ? shinyPalette(pal) : pal);
    })();
    return () => { alive = false; };
  }, [root, logo, symbol, shiny]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(root);
    mixerRef.current = mixer;
    const clip = pickIdle(animations, !!spawn.species.flying);
    if (clip) mixer.clipAction(clip).reset().play();
    return () => { mixer.stopAllAction(); mixerRef.current = null; };
  }, [root, animations, spawn.species.flying]);

  const groundY = useMemo(() => surfaceY(spawn.x, spawn.z), [spawn.x, spawn.z]);
  const hover = spawn.species.flying ? 1.1 : 0;
  const yaw = useMemo(() => (Math.abs(spawn.x * 13.7 + spawn.z * 7.3) % (Math.PI * 2)), [spawn.x, spawn.z]);

  useFrame((_, delta) => {
    const g = outer.current;
    if (!g) return;
    // En el estadio los combatientes son copias propias (BattleArena): los salvajes del mundo no se ven.
    if (inArena()) { g.visible = false; return; }

    // Escondidos: un Rare/Epic aparece al acercarse (o con Radar) y, una vez visto, se queda a la vista.
    if (see) {
      const d = Math.hypot(spawn.x - playerPos.x, spawn.z - playerPos.z);
      if (d < see) revealed.current = true;
    }
    const shown = !see || revealed.current || active || radarOn();
    vis.current = Math.max(0, Math.min(1, vis.current + (shown ? delta * 2.5 : -delta * 2.5)));
    g.visible = vis.current > 0.02;
    if (!g.visible) return;
    g.scale.setScalar(0.3 + 0.7 * vis.current);
    mixerRef.current?.update(delta);

    // Absorción: CaptureBall dirige (capFx). El monstruo se vuelve luz, encoge girando en espiral y se
    // estira hacia la boca de la bola; al escaparse hace el camino inverso y sacude la cabeza, enfadado.
    const inBall = active && (cap.phase === 'absorb' || cap.phase === 'shake' || cap.phase === 'caught');
    const d = active ? capFx.dissolve : 0;
    const glow = active ? capFx.glow : 0;
    const inn = inner.current;
    if (inn) {
      const s = Math.pow(1 - d, 1.5);
      const stretch = Math.sin(Math.min(1, d * 1.15) * Math.PI) * 0.45;
      const h = spawn.size * 0.5;
      inn.visible = d < 0.985;
      inn.scale.set(scale * s * (1 - stretch * 0.45), scale * s * (1 + stretch), scale * s * (1 - stretch * 0.45));
      inn.rotation.set(0, d * d * 9, 0);
      if (d > 0.001) {
        g.updateMatrixWorld();
        g.worldToLocal(_b.copy(capFx.ball));
        const pull = d * d;
        inn.position.set(_b.x * pull, h + (_b.y - h) * pull - h * s * (1 + stretch), _b.z * pull);
      } else inn.position.set(0, 0, 0);
      const an = active ? capFx.annoy : 0;
      if (an > 0.001) {
        annoyClock.current += delta;
        const ac = annoyClock.current;
        inn.rotation.z = Math.sin(ac * 38) * 0.16 * an;
        inn.rotation.y += Math.sin(ac * 19) * 0.22 * an;
        inn.position.y += Math.abs(Math.sin(ac * 16)) * 0.14 * an;
      } else { annoyClock.current = 0; inn.rotation.z = 0; }
    }
    const glowing = glow > 0.001;
    if (glowing || (glowMats.current.length && glowMats.current[0].mat.emissive.r !== glowMats.current[0].emissive.r)) {
      for (const gm of glowMats.current) {
        gm.mat.emissive.copy(gm.emissive).lerp(capFx.tint, glow * 0.72);
        gm.mat.color.copy(gm.color).lerp(capFx.tint, glow * 0.7);
        if (gm.rim) {
          gm.rim.rim.value = gm.rim0 + glow * 1.4;
          gm.rim.rimColor.value.copy(_white).lerp(capFx.tint, glow);
        }
      }
    }
    const lineOn = glow < 0.3;
    if (outlines.current.length && outlines.current[0].visible !== lineOn) for (const o of outlines.current) o.visible = lineOn;

    if (spawn.species.flying && !inBall) {
      bobPhase.current += delta * 1.6;
      g.position.y = groundY + hover + Math.sin(bobPhase.current) * 0.14;
    }

    if (active) {
      // Centro del monstruo en el mundo → posición y tamaño en pantalla para el aro; y posición para la bola.
      _c.set(g.position.x, g.position.y + spawn.size * 0.5, g.position.z);
      live.targetPos.copy(_c);
      capFx.rest.copy(_c); capFx.size = spawn.size;
      capFx.body.set(_c.x, _c.y, _c.z);
      if (inn && d > 0.001) inn.getWorldPosition(capFx.body).y += spawn.size * 0.5 * Math.pow(1 - d, 1.5);
      _t.copy(_c).project(camera);
      const sx = (_t.x * 0.5 + 0.5) * viewport.width;
      const sy = (-_t.y * 0.5 + 0.5) * viewport.height;
      // Tamaño del aro: alto en pantalla del monstruo (proyectando base y cima), con margen.
      const base = _c.clone().setY(g.position.y).project(camera);
      const top = _c.clone().setY(g.position.y + spawn.size).project(camera);
      const px = Math.abs((base.y - top.y) * 0.5 * viewport.height);
      live.screen.x = sx; live.screen.y = sy;
      live.screen.size = Math.max(90, Math.min(viewport.height * 0.5, px * 2.1));
      live.screen.visible = _t.z < 1;
      if (cap.phase === 'aim') {
        live.ringClock += delta;
        live.ringK = 0.18 + 0.82 * (0.5 + 0.5 * Math.cos(live.ringClock * 3.4));
      }
    }
  });

  const inBall = active && (cap.phase === 'absorb' || cap.phase === 'shake' || cap.phase === 'caught');
  return (
    <group ref={outer} position={[spawn.x, groundY + hover, spawn.z]} rotation={[0, yaw, 0]} visible={false}>
      <group ref={inner} scale={[scale, scale, scale]}>
        <primitive object={root} position={[0, lift, 0]} />
      </group>
      {spawn.token && !inBall && <TokenCoin logo={logo} symbol={spawn.token.symbol} shiny={shiny} y={spawn.size + 0.5} />}
      {(stage === 3 || shiny) && !inBall && (
        <group position={[0, -hover, 0]}>
          <Aura color={shiny ? 0xff8ce8 : 0x9ff2ff} height={spawn.size} strength={shiny ? 0.8 : 0.6} />
        </group>
      )}
      {radar && see && !active && <RadarBeam epic={spawn.species.tier === 'Epic'} from={spawn.size + (spawn.token ? 1.1 : 0.4)} />}
    </group>
  );
};

export const Monsters: React.FC = () => {
  const cap = useCapture();
  const { spawns } = useWild();
  return (
    <>
      {spawns.filter((s) => !cap.caught.has(s.id)).map((s) => (
        // Un Suspense por monstruo: cargar el GLB de un token nuevo no debe suspender la escena entera.
        <Suspense key={s.id} fallback={null}>
          <MonsterView spawn={s} />
        </Suspense>
      ))}
    </>
  );
};

for (const s of DEMO_SPAWNS) useGLTF.preload(s.model);
