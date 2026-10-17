// El combate en 3D: los dos monstruos frente a frente en el estadio, peleando de verdad.
//
// - Fighter: el GLB del monstruo con el mismo cel-shading y colores de token que en el mundo, y sus
//   animaciones del pack (Punch/Headbutt/Bite para atacar, HitReact al recibir, Death al caer, Yes/Dance
//   al ganar). Embiste o lanza según el ataque, retrocede y destella al recibir, cae si queda KO.
// - AttackFx: el efecto de cada tipo (bola de fuego, rayo, rocas que caen, ondas psíquicas, esquirlas de
//   hielo, rayo de dragón…) con un sistema de partículas propio y un aro de choque en el suelo.
// - BattleCamera: planos de cine — presentación del rival, suelta del monstruo del jugador, plano general,
//   plano por encima del hombro en cada ataque, sacudida en el impacto y órbita al ganador.
// - Números de daño y "¡Súper eficaz!" flotando sobre el golpeado.
//
// Todo lo que cambia por frame va por refs y el estado compartido de arenaLayout.stage; React solo se
// entera cuando cambia el combate en sí (qué golpe se juega), nunca por frame.
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { toonifyObject } from './toon';
import { paletteFor, naturalPalette, shinyPalette, applyPalette, dotTexture, ringTexture } from './tokenLook';
import { pickIdle } from './Monsters';
import { useBattle, getBattle, inArena, type BattleSide, type BattleAnim } from './battleStore';
import { SPOT, other, facing, stagePoint, stage, stageDt, FIGHTER_HEIGHT, INTRO, EAST as E } from './arenaLayout';
import { camCtl } from './cameraStore';
import { ARENA, arenaY } from './terrain';
import type { MonType, Species } from './species';
import type { PortraitLook } from './portrait';
import { t as tr } from '../i18n';
import { ImpactBurst, triggerImpact } from './battle/ImpactBurst';

// ---------------------------------------------------------------- estilos de ataque por tipo

type FxMode = 'contact' | 'orb' | 'bolt' | 'rocks' | 'wave' | 'shards' | 'beam';
interface FxStyle { mode: FxMode; c1: number; c2: number }
const FX: Record<MonType, FxStyle> = {
  Normal: { mode: 'contact', c1: 0xfff4c9, c2: 0xffffff },
  Fighting: { mode: 'contact', c1: 0xff8a3d, c2: 0xffe0b0 },
  Bug: { mode: 'contact', c1: 0xb6e04a, c2: 0xf0ffb0 },
  Steel: { mode: 'contact', c1: 0xcfe0f0, c2: 0xffffff },
  Fire: { mode: 'orb', c1: 0xff6a1a, c2: 0xffd23a },
  Water: { mode: 'orb', c1: 0x2f9dff, c2: 0xbff0ff },
  Grass: { mode: 'orb', c1: 0x4fd65a, c2: 0xd8ff8a },
  Poison: { mode: 'orb', c1: 0xb45ce6, c2: 0xefb0ff },
  Flying: { mode: 'orb', c1: 0x9fd8ff, c2: 0xffffff },
  Electric: { mode: 'bolt', c1: 0xffe23a, c2: 0xfffbd0 },
  Rock: { mode: 'rocks', c1: 0xb99d74, c2: 0xefe2c4 },
  Ground: { mode: 'rocks', c1: 0xc9964e, c2: 0xf3d9a4 },
  Psychic: { mode: 'wave', c1: 0xff5fae, c2: 0xffd3ec },
  Ghost: { mode: 'wave', c1: 0x8a6cff, c2: 0xd9ccff },
  Dark: { mode: 'wave', c1: 0x8455d6, c2: 0xe0c8ff },
  Fairy: { mode: 'wave', c1: 0xff9ad8, c2: 0xffffff },
  Ice: { mode: 'shards', c1: 0x8fe6ff, c2: 0xffffff },
  Dragon: { mode: 'beam', c1: 0x7b5cff, c2: 0xff7ae0 },
};
/** "Ape In" y los golpes físicos embisten hasta el rival; los especiales lanzan desde su sitio. */
const isContact = (t: MonType) => FX[t].mode === 'contact';

const WIND = 0.64; // = WIND_MS de battleStore, en segundos
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// ---------------------------------------------------------------- partículas

const MAXP = 1400;
interface Particle { life: number; max: number; vx: number; vy: number; vz: number; g: number; drag: number; size: number }
/**
 * Un solo Points aditivo para todas las partículas del combate: chispas, brasas, gotas, polvo, hojas.
 * Aditivo y sin escribir profundidad, así que no hay que ordenarlas y nunca tapan a los monstruos.
 */
class Sparks {
  geo = new THREE.BufferGeometry();
  pos = new Float32Array(MAXP * 3);
  col = new Float32Array(MAXP * 3);
  siz = new Float32Array(MAXP);
  base = new Float32Array(MAXP * 3);
  p: Particle[] = Array.from({ length: MAXP }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, size: 0 }));
  next = 0;
  mat: THREE.ShaderMaterial;
  points: THREE.Points;
  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTexture() }, scale: { value: 420 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }
  emit(at: THREE.Vector3, n: number, o: { color: number; color2?: number; speed: number; up?: number; g?: number; drag?: number; size: number; life: number; spread?: number; dir?: THREE.Vector3 }) {
    const c1 = new THREE.Color(o.color), c2 = new THREE.Color(o.color2 ?? o.color), c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % MAXP;
      const p = this.p[i];
      // Dirección aleatoria en la esfera, sesgada hacia `dir` si viene.
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
      if (o.dir) { const s = o.spread ?? 0.5; vx = o.dir.x + vx * s; vy = o.dir.y + vy * s; vz = o.dir.z + vz * s; }
      const sp = o.speed * (0.45 + Math.random() * 0.75);
      p.vx = vx * sp; p.vy = vy * sp + (o.up ?? 0); p.vz = vz * sp;
      p.g = o.g ?? 0; p.drag = o.drag ?? 1.5; p.max = p.life = o.life * (0.6 + Math.random() * 0.6);
      p.size = o.size * (0.6 + Math.random() * 0.8);
      this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = at.y; this.pos[i * 3 + 2] = at.z;
      c.copy(c1).lerp(c2, Math.random());
      this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;
    }
  }
  update(dt: number) {
    for (let i = 0; i < MAXP; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.siz[i] = 0; continue; }
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.g * dt;
      this.pos[i * 3] += p.vx * dt; this.pos[i * 3 + 1] += p.vy * dt; this.pos[i * 3 + 2] += p.vz * dt;
      const f = clamp01(p.life / p.max);
      this.siz[i] = p.size * (0.4 + 0.6 * f);
      this.col[i * 3] = this.base[i * 3] * f; this.col[i * 3 + 1] = this.base[i * 3 + 1] * f; this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// ---------------------------------------------------------------- combatiente

const findClip = (clips: THREE.AnimationClip[], re: RegExp) => clips.find((c) => re.test(c.name)) ?? null;

interface FighterProps { side: BattleSide; model: string; look: PortraitLook; species: Species; enterAt: number }

const Fighter: React.FC<FighterProps> = React.memo(({ side, model, look, species, enterAt }) => {
  const { scene, animations } = useGLTF(model);
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  const { root, scale, lift, mats } = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    toonifyObject(cloned, { outline: 0.02, rim: 0.14 });
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const h = Math.max(1e-3, size.y);
    let sc = (FIGHTER_HEIGHT[species.tier] ?? 1.5) / h;
    // Los alargados (dinosaurios, tiburones) no pueden invadir el campo del rival.
    const wide = Math.max(size.x, size.z) * sc;
    if (wide > 3) sc *= 3 / wide;
    const list: THREE.MeshToonMaterial[] = [];
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.isOutline) {
        m.castShadow = true;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) {
          if ((mat as THREE.MeshToonMaterial).emissive) list.push(mat as THREE.MeshToonMaterial);
        }
      }
    });
    return { root: cloned, scale: sc, lift: -box.min.y, mats: list };
  }, [scene, species.tier]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const pal = look.symbol ? await paletteFor(look.logo, look.symbol) : look.shiny ? naturalPalette(root) : null;
      if (alive) applyPalette(root, pal && look.shiny ? shinyPalette(pal) : pal);
    })();
    return () => { alive = false; };
  }, [root, look.logo, look.symbol, look.shiny]);

  // Acciones del mezclador: se buscan por nombre porque cada familia del pack las llama distinto.
  const anim = useMemo(() => {
    const mixer = new THREE.AnimationMixer(root);
    const idleClip = pickIdle(animations, !!species.flying);
    const act = (c: THREE.AnimationClip | null) => (c ? mixer.clipAction(c) : null);
    const a = {
      mixer,
      idle: act(idleClip),
      attack: act(findClip(animations, /Punch|Headbutt|Bite|Attack|Weapon|Kick|Sword/i)),
      hit: act(findClip(animations, /HitReact|HitRe[ci]{2}ve|Hit|Damage/i)),
      death: act(findClip(animations, /Death|Die/i)),
      win: act(findClip(animations, /Dance|Yes|Jump$|Wave/i)),
      swims: !!idleClip && /Swim/i.test(idleClip.name),
      cur: null as THREE.AnimationAction | null,
    };
    for (const k of ['attack', 'hit', 'death'] as const) {
      const x = a[k];
      if (x) { x.setLoop(THREE.LoopOnce, 1); x.clampWhenFinished = true; }
    }
    return a;
  }, [root, animations, species.flying]);

  const play = (next: THREE.AnimationAction | null, fade = 0.12) => {
    if (!next) return;
    if (anim.cur === next) { next.reset().play(); return; }
    next.reset().fadeIn(fade).play();
    anim.cur?.fadeOut(fade);
    anim.cur = next;
  };

  useEffect(() => {
    play(anim.idle, 0);
    const onDone = (e: { action: THREE.AnimationAction }) => {
      if (e.action === anim.death) return;
      const b = getBattle();
      const won = b.turn === 'over' && ((b.result === 'win' && side === 'player') || (b.result === 'lose' && side === 'foe'));
      play(won ? anim.win ?? anim.idle : anim.idle, 0.2);
    };
    anim.mixer.addEventListener('finished', onDone as never);
    return () => { anim.mixer.removeEventListener('finished', onDone as never); anim.mixer.stopAllAction(); };
  }, [anim]); // eslint-disable-line react-hooks/exhaustive-deps

  const home = useMemo(() => stagePoint(SPOT[side]), [side]);
  const toFoe = useMemo(() => new THREE.Vector3(SPOT[other(side)].x - SPOT[side].x, 0, SPOT[other(side)].z - SPOT[side].z).normalize(), [side]);
  const hover = species.flying || anim.swims ? 0.95 : 0;
  const st = useRef({ animId: 0, phase: '', tPhase: 0, flash: 0, knock: 0, knockV: 0, entered: false, pop: 0, down: 0, over: false, hop: 0 });

  useFrame((_, dtRaw) => {
    const g = outer.current, ig = inner.current;
    if (!g || !ig) return;
    const dt = stageDt(dtRaw);
    const S = st.current;
    const b = getBattle();
    anim.mixer.update(dt);

    // Entrada: aparece con un destello (el del jugador sale de su bola, el salvaje ya estaba allí).
    if (!S.entered) {
      if (stage.t < enterAt) { g.visible = false; return; }
      S.entered = true; g.visible = true; S.pop = 0; S.flash = 1;
    }
    S.pop = Math.min(1, S.pop + dt * 3.2);
    const popK = S.pop < 1 ? 1 + Math.sin(S.pop * Math.PI) * 0.18 - (1 - S.pop) * 0.9 : 1;

    // Golpe en curso.
    const a: BattleAnim | null = b.anim;
    let lunge = 0;
    if (a) {
      if (a.id !== S.animId || a.phase !== S.phase) {
        const fresh = a.id !== S.animId;
        S.animId = a.id; S.phase = a.phase; S.tPhase = 0;
        if (a.by === side && fresh) play(anim.attack ?? anim.win ?? null, 0.08);
        if (a.by !== side && a.phase === 'impact') {
          if (a.dmg > 0) {
            play(anim.hit, 0.05);
            S.flash = 1;
            S.knockV = a.ko ? 10 : a.eff >= 2 ? 7 : 4.5;
          } else S.knockV = 2.5; // esquiva: un saltito atrás y nada más
        }
      }
      S.tPhase += dt;
      if (a.by === side) {
        const t = a.phase === 'wind' ? S.tPhase : WIND + S.tPhase;
        if (isContact(a.type)) {
          // Embestida: toma impulso, se lanza hasta casi tocar al rival y vuelve.
          const gap = home.distanceTo(stagePoint(SPOT[other(side)])) - 1.5;
          if (t < 0.18) lunge = -0.35 * ease(t / 0.18);
          else if (t < WIND) lunge = -0.35 + (gap + 0.35) * ease((t - 0.18) / (WIND - 0.18));
          else lunge = gap * (1 - ease(clamp01((t - WIND) / 0.42)));
        } else {
          // Especial: paso adelante al lanzar, y de vuelta.
          lunge = t < WIND ? 0.55 * Math.sin(clamp01(t / WIND) * Math.PI * 0.5) : 0.55 * (1 - ease(clamp01((t - WIND) / 0.4)));
        }
      }
    }

    // Retroceso con muelle al recibir.
    S.knockV -= S.knock * 60 * dt;
    S.knockV *= Math.exp(-9 * dt);
    S.knock += S.knockV * dt;

    // KO y victoria.
    const lost = b.turn === 'over' && ((b.result === 'win' && side === 'foe') || (b.result === 'lose' && side === 'player'));
    const won = b.turn === 'over' && ((b.result === 'win' && side === 'player') || (b.result === 'lose' && side === 'foe'));
    if (b.turn === 'over' && !S.over) {
      S.over = true;
      if (lost) { if (anim.death) play(anim.death, 0.1); }
      else if (won) play(anim.win ?? anim.idle, 0.2);
    }
    if (lost) S.down = Math.min(1, S.down + dt * 0.55);
    if (won) S.hop += dt;

    // Destello blanco al recibir o al aparecer.
    S.flash = Math.max(0, S.flash - dt * 3.2);
    const f = S.flash * S.flash;
    for (const m of mats) m.emissive.setRGB(f, f, f);

    const bob = hover ? Math.sin(stage.t * 2.1 + (side === 'foe' ? 1.3 : 0)) * 0.12 : 0;
    const hop = won && !anim.win ? Math.abs(Math.sin(S.hop * 5)) * 0.35 : 0;
    const sink = lost ? ease(clamp01((S.down - 0.45) / 0.55)) : 0;
    g.position.copy(home).addScaledVector(toFoe, lunge - S.knock);
    g.position.y = home.y + (hover * (1 - (lost ? ease(S.down) : 0))) + bob + hop - sink * 0.6;
    g.rotation.y = facing(side);
    // Sin animación de muerte, cae de lado.
    if (lost && !anim.death) g.rotation.z = -ease(clamp01(S.down * 1.6)) * 1.3 * (side === 'foe' ? -1 : 1);
    ig.scale.setScalar(scale * popK * (1 - sink * 0.9));

    stage.pos[side].set(g.position.x, g.position.y, g.position.z);
    stage.height[side] = (FIGHTER_HEIGHT[species.tier] ?? 1.5);
  });

  return (
    <group ref={outer} visible={false}>
      <group ref={inner} scale={[scale, scale, scale]}>
        <primitive object={root} position={[0, lift, 0]} />
      </group>
    </group>
  );
});
Fighter.displayName = 'Fighter';

// ---------------------------------------------------------------- efectos de ataque

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const BOLT_SEGS = 14;
const CONFETTI = [0xff5c7a, 0xffd23a, 0x5cd6ff, 0x8cff6a, 0xc58cff, 0xffffff];
const _dir = new THREE.Vector3(), _mid = new THREE.Vector3(), _sc = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();

const AttackFx: React.FC = () => {
  const sparks = useMemo(() => new Sparks(), []);
  useEffect(() => () => sparks.dispose(), [sparks]);

  // Piezas reutilizables: proyectil, aros de choque, rayo, rocas, esquirlas, haz y la bola del jugador.
  const orb = useRef<THREE.Group>(null);
  const rings = useRef<THREE.Mesh[]>([]);
  const waves = useRef<THREE.Mesh[]>([]);
  const rocks = useRef<THREE.Mesh[]>([]);
  const shards = useRef<THREE.Mesh[]>([]);
  const beam = useRef<THREE.Mesh>(null);
  const ball = useRef<THREE.Group>(null);

  const mats = useMemo(() => ({
    core: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
    glow: new THREE.SpriteMaterial({ color: 0xffffff, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    ring: () => new THREE.MeshBasicMaterial({ color: 0xffffff, map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    wave: () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    bolt: new THREE.MeshBasicMaterial({ color: 0xfffbd0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    boltGlow: new THREE.MeshBasicMaterial({ color: 0xffd21a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
    rock: new THREE.MeshToonMaterial({ color: 0xb99d74 }),
    shard: new THREE.MeshBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.92 }),
    beam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  }), []);
  const ringMats = useMemo(() => [mats.ring(), mats.ring(), mats.ring()], [mats]);
  const waveMats = useMemo(() => [mats.wave(), mats.wave(), mats.wave()], [mats]);
  // Rayo: cadena de cilindros instanciados (núcleo blanco + halo amarillo); las líneas de WebGL miden 1 px.
  const { boltCore, boltGlow, boltPts } = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const mk = (m: THREE.Material) => {
      const im = new THREE.InstancedMesh(g, m, BOLT_SEGS);
      im.frustumCulled = false; im.visible = false;
      return im;
    };
    return { boltCore: mk(mats.bolt), boltGlow: mk(mats.boltGlow), boltPts: Array.from({ length: BOLT_SEGS + 1 }, () => new THREE.Vector3()) };
  }, [mats]);

  const S = useRef({ id: 0, phase: '', t: 0, ringT: [9, 9, 9], ringAt: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], ringC: [0, 0, 0], ringN: 0, ballDone: false, dustT: 0, confT: 0, faintT: 0 });

  const ring = (at: THREE.Vector3, color: number, big = false) => {
    const s = S.current;
    const i = s.ringN++ % 3;
    s.ringT[i] = 0; s.ringAt[i].copy(at); s.ringC[i] = color;
    ringMats[i].color.setHex(color);
    const m = rings.current[i]; if (m) m.userData.big = big;
  };

  // Precompilar los shaders de todas las piezas al abrir el estadio: three solo compila lo visible, y
  // compilar a mitad del primer golpe congelaba la imagen justo en el impacto.
  const group = useRef<THREE.Group>(null);
  const { gl, camera, scene } = useThree();
  const warmed = useRef(false);
  useEffect(() => {
    const g = group.current;
    if (!g || warmed.current) return;
    warmed.current = true;
    const hidden: THREE.Object3D[] = [];
    g.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    gl.compile(scene, camera);
    for (const o of hidden) o.visible = false;
  }, [gl, camera, scene]);

  const flashLight = useRef<THREE.PointLight>(null);

  useFrame((_, dtRaw) => {
    const dt = stageDt(dtRaw);
    const s = S.current;
    const b = getBattle();
    const a = b.anim;

    // Golpe de luz del color del ataque sobre el golpeado (siempre montada: cambiar el número de luces
    // obligaría a recompilar todos los materiales a mitad del combate).
    const fl = flashLight.current;
    if (fl) fl.intensity = Math.max(0, fl.intensity - Math.min(dtRaw, 0.05) * 90);

    // Confeti sobre el monstruo del jugador si gana.
    if (b.turn === 'over' && b.result === 'win') {
      s.confT += dt;
      if (s.confT < 2.6 && Math.random() < 0.7) {
        const w = stage.pos.player, h = stage.height.player;
        _c.set(w.x + (Math.random() - 0.5) * 3, w.y + h + 1.6 + Math.random(), w.z + (Math.random() - 0.5) * 3);
        sparks.emit(_c, 3, { color: CONFETTI[(Math.random() * CONFETTI.length) | 0], speed: 1.2, up: 0.5, g: 1.6, drag: 1.2, size: 0.2, life: 2.2 });
      }
      // Fuegos artificiales sobre las gradas.
      if (s.confT < 5 && Math.floor(s.confT / 0.45) !== Math.floor((s.confT - dt) / 0.45)) {
        const ang = Math.random() * Math.PI * 2, r = 12 + Math.random() * 10;
        _c.set(ARENA.x + Math.cos(ang) * r, arenaY() + 16 + Math.random() * 6, ARENA.z + Math.sin(ang) * r);
        const col = CONFETTI[(Math.random() * CONFETTI.length) | 0];
        sparks.emit(_c, 90, { color: col, color2: 0xffffff, speed: 9, g: 2.2, drag: 1.3, size: 1.1, life: 1.5 });
      }
    } else s.confT = 0;

    // Desmayo: cuando el cuerpo toca el suelo, polvareda en anillo y chispas que suben como un suspiro.
    if (b.turn === 'over' && (b.result === 'win' || b.result === 'lose')) {
      const side: BattleSide = b.result === 'win' ? 'foe' : 'player';
      const before = s.faintT;
      s.faintT += dt;
      if (before < 0.95 && s.faintT >= 0.95) {
        const w = stage.pos[side];
        _c.set(w.x, arenaY() + 0.15, w.z);
        sparks.emit(_c, 60, { color: 0xd9c9a8, color2: 0xffffff, speed: 4.5, up: 0.6, g: 3, size: 0.34, life: 0.9, drag: 3 });
        ring(_d.set(w.x, arenaY() + 0.03, w.z), 0xe8dcc0, true);
        stage.shake = Math.max(stage.shake, 0.3);
      }
      if (s.faintT > 1 && s.faintT < 2.2 && Math.random() < 0.5) {
        const w = stage.pos[side];
        _c.set(w.x + (Math.random() - 0.5) * 1.2, w.y + 0.3, w.z + (Math.random() - 0.5) * 1.2);
        sparks.emit(_c, 1, { color: 0xcfe6ff, color2: 0xffffff, speed: 0.3, up: 1.4, drag: 0.8, size: 0.22, life: 1.2 });
      }
    } else s.faintT = 0;

    // La bola del jugador: del entrenador a su marca de salida, y se abre en un destello.
    const bt = stage.t;
    if (ball.current) {
      const t0 = INTRO.ballAt, t1 = INTRO.ballEnd;
      const on = bt > t0 && bt < t1;
      ball.current.visible = on;
      if (on) {
        const k = (bt - t0) / (t1 - t0);
        stagePoint(SPOT.trainer, 1.4, _a); stagePoint(SPOT.player, 0.5, _b);
        ball.current.position.lerpVectors(_a, _b, k);
        ball.current.position.y += Math.sin(k * Math.PI) * 1.6;
        ball.current.rotation.z -= dt * 14;
      }
      if (!s.ballDone && bt >= t1) {
        s.ballDone = true;
        stagePoint(SPOT.player, 0.7, _a);
        sparks.emit(_a, 70, { color: 0xffffff, color2: 0xfff2a8, speed: 5, size: 0.28, life: 0.6, drag: 3 });
        ring(stagePoint(SPOT.player, 0.03, _b), 0xffffff, true);
      }
    }
    // El salvaje aparece al abrir el estadio con un remolino de hojas y polvo.
    if (bt > INTRO.foeAt && s.dustT === 0) {
      s.dustT = 1;
      stagePoint(SPOT.foe, 0.4, _a);
      sparks.emit(_a, 60, { color: 0x9ee07a, color2: 0xffffff, speed: 4, up: 1.5, size: 0.24, life: 0.8, drag: 2.5 });
      ring(stagePoint(SPOT.foe, 0.03, _b), 0xbff0a0, true);
    }

    // Golpe en curso.
    let orbOn = false, beamOn = false, boltOn = false;
    for (const r of rocks.current) if (r) r.visible = false;
    for (const sh of shards.current) if (sh) sh.visible = false;
    for (const w of waves.current) if (w) w.visible = false;
    if (a) {
      if (a.id !== s.id) { s.id = a.id; s.t = 0; s.phase = 'wind'; }
      s.t += dt;
      const st = FX[a.type];
      const from = stage.pos[a.by], to = stage.pos[other(a.by)];
      const hFrom = stage.height[a.by], hTo = stage.height[other(a.by)];
      _a.copy(from).setY(from.y + hFrom * 0.55); // pecho del atacante
      _b.copy(to).setY(to.y + hTo * 0.5); // centro del golpeado
      const t = s.t;
      const k = clamp01((t - 0.2) / (WIND - 0.2)); // avance del proyectil

      if (a.phase === 'impact' && s.phase !== 'impact') {
        s.phase = 'impact';
        // Impacto: estallido del color del tipo + aro en el suelo + sacudida.
        if (a.dmg > 0) {
          const strong = a.eff >= 2;
          const big = strong || a.crit;
          sparks.emit(_b, big ? 120 : 70, { color: st.c1, color2: a.crit ? 0xffe066 : st.c2, speed: big ? 7.5 : 5.5, up: 1, g: 4, size: big ? 0.36 : 0.28, life: 0.75, drag: 2.4 });
          sparks.emit(_b, 24, { color: 0xffffff, speed: 3, size: 0.5, life: 0.25, drag: 4 });
          ring(_c.copy(to).setY(arenaY() + 0.03), st.c1, big || a.ko);
          triggerImpact(_b, st.c1, st.c2, 0.75 + a.pct * 1.1 + (strong ? 0.25 : 0), a.crit);
          // Sacudida y pausa de impacto proporcionales a cuánta vida se lleva el golpe; en el KO, cámara lenta.
          stage.shake = Math.max(stage.shake, a.ko ? 0.75 : Math.min(0.72, 0.16 + a.pct * 0.95 + (strong ? 0.1 : 0) + (a.crit ? 0.2 : 0)));
          stage.freeze = a.ko ? 0.18 : Math.min(0.2, 0.045 + a.pct * 0.12 + (strong ? 0.03 : 0) + (a.crit ? 0.08 : 0));
          if (a.crit || a.ko) stage.kick = 1;
          if (a.ko) {
            stage.slow = 1.5;
            sparks.emit(_b, 90, { color: 0xffffff, color2: st.c2, speed: 11, size: 0.3, life: 1.1, drag: 1.6 });
          }
          if (fl) { fl.color.setHex(st.c1); fl.position.copy(_b).setY(_b.y + 0.8); fl.intensity = a.ko ? 60 : strong ? 45 : 28; }
          if (st.mode === 'rocks') sparks.emit(_c.copy(to).setY(arenaY() + 0.2), 50, { color: st.c1, color2: 0xffffff, speed: 4, up: 2, g: 6, size: 0.3, life: 0.9, drag: 1.5 });
        } else {
          sparks.emit(_b, 16, { color: 0xbfc8d8, speed: 2.2, size: 0.2, life: 0.4 });
        }
      }

      switch (st.mode) {
        case 'contact':
          // Estela de velocidad detrás del que embiste.
          if (a.phase === 'wind' && t > 0.2) sparks.emit(_a, 2, { color: st.c1, color2: st.c2, speed: 0.6, size: 0.22, life: 0.3 });
          break;
        case 'orb': {
          if (a.phase === 'wind' && t > 0.12) {
            orbOn = true;
            _c.lerpVectors(_a, _b, ease(k));
            _c.y += Math.sin(k * Math.PI) * 0.7;
            orb.current?.position.copy(_c);
            const grow = clamp01((t - 0.12) / 0.15);
            orb.current?.scale.setScalar(0.4 + grow * 0.6);
            mats.core.color.setHex(st.c2); mats.glow.color.setHex(st.c1);
            // Estela: brasas (fuego), gotas (agua, caen), hojas (planta), gas (veneno), ráfaga (volador).
            const g = a.type === 'Water' ? 7 : a.type === 'Fire' ? -1.5 : 0;
            sparks.emit(_c, 4, { color: st.c1, color2: st.c2, speed: 1.2, size: 0.26, life: 0.45, g, drag: 2 });
          }
          break;
        }
        case 'bolt': {
          // Carga: chispas alrededor del atacante; al impacto, rayo del cielo sobre el rival.
          if (a.phase === 'wind' && t > 0.1) sparks.emit(_a, 3, { color: st.c1, color2: 0xffffff, speed: 2.5, size: 0.2, life: 0.25, drag: 5 });
          if (a.phase === 'impact' && t < WIND + 0.32) {
            boltOn = true;
            const top = _d.copy(_b).setY(_b.y + 9);
            for (let i = 0; i <= BOLT_SEGS; i++) {
              const f = i / BOLT_SEGS;
              const j = i === 0 || i === BOLT_SEGS ? 0 : 0.7;
              boltPts[i].set(
                top.x + (_b.x - top.x) * f + (Math.random() - 0.5) * j,
                top.y + (_b.y - top.y) * f,
                top.z + (_b.z - top.z) * f + (Math.random() - 0.5) * j,
              );
            }
            for (let i = 0; i < BOLT_SEGS; i++) {
              const p0 = boltPts[i], p1 = boltPts[i + 1];
              _dir.subVectors(p1, p0);
              const len = _dir.length();
              _q.setFromUnitVectors(_up, _dir.divideScalar(len));
              _mid.addVectors(p0, p1).multiplyScalar(0.5);
              boltCore.setMatrixAt(i, _m4.compose(_mid, _q, _sc.set(0.06, len * 1.05, 0.06)));
              boltGlow.setMatrixAt(i, _m4.compose(_mid, _q, _sc.set(0.24, len * 1.05, 0.24)));
            }
            boltCore.instanceMatrix.needsUpdate = true;
            boltGlow.instanceMatrix.needsUpdate = true;
            const flick = Math.random() > 0.2 ? 1 : 0.25;
            mats.bolt.opacity = flick; mats.boltGlow.opacity = 0.5 * flick;
            if (Math.random() < 0.5) sparks.emit(_b, 6, { color: st.c1, color2: 0xffffff, speed: 5, size: 0.24, life: 0.3, drag: 4 });
          }
          break;
        }
        case 'rocks': {
          // Tres rocas caen sobre el rival y aterrizan justo en el impacto.
          if (a.phase === 'wind' && t > 0.15) {
            const fall = clamp01((t - 0.15) / (WIND - 0.15));
            rocks.current.forEach((r, i) => {
              if (!r) return;
              r.visible = true;
              const ox = (i - 1) * 0.55, oz = ((i * 37) % 3 - 1) * 0.4;
              r.position.set(to.x + ox, to.y + 0.3 + (1 - fall * fall) * 6 + i * 0.4 * (1 - fall), to.z + oz);
              r.rotation.x += dt * 6; r.rotation.y += dt * 4;
            });
            mats.rock.color.setHex(st.c1);
          }
          break;
        }
        case 'wave': {
          // Tres ondas que viajan del atacante al rival, en fila.
          if (a.phase === 'wind' && t > 0.08) {
            waves.current.forEach((w, i) => {
              if (!w) return;
              const kk = clamp01((t - 0.08 - i * 0.09) / (WIND - 0.2));
              if (kk <= 0 || kk >= 1) return;
              w.visible = true;
              w.position.lerpVectors(_a, _b, kk);
              w.lookAt(_b);
              w.scale.setScalar(0.5 + kk * 0.9);
              waveMats[i].color.setHex(i % 2 ? st.c2 : st.c1);
              waveMats[i].opacity = 0.9 * Math.sin(kk * Math.PI);
            });
            if (Math.random() < 0.5) sparks.emit(_a, 1, { color: st.c2, speed: 1.5, size: 0.2, life: 0.4 });
          }
          break;
        }
        case 'shards': {
          if (a.phase === 'wind' && t > 0.16) {
            shards.current.forEach((sh, i) => {
              if (!sh) return;
              const kk = clamp01((t - 0.16 - i * 0.04) / (WIND - 0.3));
              if (kk <= 0 || kk >= 1) return;
              sh.visible = true;
              const off = (i - 2) * 0.28;
              _c.lerpVectors(_a, _b, ease(kk));
              _c.z += off * (1 - kk); _c.y += Math.sin(kk * Math.PI) * 0.4 + off * 0.3 * (1 - kk);
              sh.position.copy(_c);
              sh.lookAt(_b); sh.rotateX(Math.PI / 2);
            });
            if (Math.random() < 0.6) sparks.emit(_a, 1, { color: 0xffffff, color2: st.c1, speed: 1, size: 0.18, life: 0.5, g: 1 });
          }
          break;
        }
        case 'beam': {
          if (t > 0.28 && t < WIND + 0.3) {
            beamOn = true;
            const grow = clamp01((t - 0.28) / (WIND - 0.28));
            const len = _a.distanceTo(_b) * grow;
            const m = beam.current!;
            _c.copy(_b).sub(_a).normalize();
            m.position.copy(_a).addScaledVector(_c, len / 2);
            m.quaternion.setFromUnitVectors(_d.set(0, 1, 0), _c);
            const wob = 1 + Math.sin(t * 60) * 0.12;
            m.scale.set(wob, Math.max(0.001, len), wob);
            mats.beam.color.setHex(Math.sin(t * 30) > 0 ? st.c1 : st.c2);
            mats.beam.opacity = t > WIND ? 1 - (t - WIND) / 0.3 : 0.95;
            sparks.emit(_a.clone().addScaledVector(_c, len), 2, { color: st.c1, color2: st.c2, speed: 2, size: 0.24, life: 0.3 });
          }
          break;
        }
      }
    } else if (s.id) s.phase = '';

    if (orb.current) orb.current.visible = orbOn;
    if (beam.current) beam.current.visible = beamOn;
    boltCore.visible = boltOn; boltGlow.visible = boltOn;

    // Aros de choque: crecen y se desvanecen.
    for (let i = 0; i < 3; i++) {
      const m = rings.current[i];
      if (!m) continue;
      const big = !!m.userData.big;
      s.ringT[i] += dt;
      const T = big ? 0.75 : 0.5;
      const k = s.ringT[i] / T;
      m.visible = k >= 0 && k < 1;
      if (!m.visible) continue;
      m.position.copy(s.ringAt[i]);
      m.scale.setScalar(0.4 + ease(k) * (big ? 4.2 : 3));
      ringMats[i].opacity = (1 - k) * 0.95;
    }

    sparks.update(dt);
  });

  return (
    <group ref={group}>
      <pointLight ref={flashLight} intensity={0} distance={10} decay={1.4} />
      <primitive object={sparks.points} />
      <group ref={orb} visible={false}>
        <mesh material={mats.core}><sphereGeometry args={[0.2, 16, 12]} /></mesh>
        <sprite material={mats.glow} scale={[1.4, 1.4, 1]} />
      </group>
      {[0, 1, 2].map((i) => (
        <mesh key={`r${i}`} ref={(m) => { if (m) rings.current[i] = m; }} material={ringMats[i]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
      {[0, 1, 2].map((i) => (
        <mesh key={`w${i}`} ref={(m) => { if (m) waves.current[i] = m; }} material={waveMats[i]} visible={false}>
          <torusGeometry args={[0.55, 0.06, 8, 36]} />
        </mesh>
      ))}
      {[0, 1, 2].map((i) => (
        <mesh key={`k${i}`} ref={(m) => { if (m) rocks.current[i] = m; }} material={mats.rock} visible={false} castShadow>
          <dodecahedronGeometry args={[0.32 + i * 0.06, 0]} />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={`s${i}`} ref={(m) => { if (m) shards.current[i] = m; }} material={mats.shard} visible={false}>
          <coneGeometry args={[0.09, 0.5, 5]} />
        </mesh>
      ))}
      <mesh ref={beam} material={mats.beam} visible={false}>
        <cylinderGeometry args={[0.16, 0.16, 1, 12, 1, true]} />
      </mesh>
      <primitive object={boltGlow} />
      <primitive object={boltCore} />
      <ImpactBurst />
      <group ref={ball} visible={false}>
        <mesh><sphereGeometry args={[0.16, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshBasicMaterial color={0xff4f6d} /></mesh>
        <mesh><sphereGeometry args={[0.16, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><meshBasicMaterial color={0xf4f6fb} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.16, 0.022, 6, 24]} /><meshBasicMaterial color={0x1a2330} /></mesh>
      </group>
    </group>
  );
};

// ---------------------------------------------------------------- números de daño

const DamagePopups: React.FC = () => {
  const b = useBattle();
  const a = b.anim;
  if (!a || a.phase !== 'impact') return null;
  const target = other(a.by);
  const p = stage.pos[target];
  const h = stage.height[target];
  const tag = a.dmg <= 0 || a.eff === 0 ? 'miss' : a.ko ? 'ko' : a.eff >= 2 ? 'super' : a.eff <= 0.5 ? 'weak' : '';
  const hit = a.dmg > 0 && a.eff !== 0;
  // Cada cifra rebota por separado, y el número sale despedido hacia el lado contrario al atacante.
  const txt = hit ? `-${a.dmg}` : a.eff === 0 ? tr('battle.immune') : tr('battle.miss');
  const drift = target === 'foe' ? -1 : 1;
  const tc = `#${FX[a.type].c1.toString(16).padStart(6, '0')}`;
  return (
    <Html key={a.id} position={[p.x, p.y + h + 0.35, p.z]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`pg-bt-dmg ${tag}${a.crit && hit ? ' crit' : ''}`} style={{ ['--dx' as string]: `${drift * 38}px`, ['--tc' as string]: tc }}>
        <b>{hit ? [...txt].map((ch, i) => <i key={i} style={{ ['--i' as string]: i }}>{ch}</i>) : txt}</b>
        {a.crit && hit && !a.ko && <span className="c">{tr('battle.critSmall')}</span>}
        {tag === 'super' && <span>{tr('battle.superBig')}</span>}
        {tag === 'ko' && <span>{tr('battle.ko')}</span>}
        {tag === 'weak' && <span>{tr('battle.weakSmall')}</span>}
      </div>
    </Html>
  );
};

// ---------------------------------------------------------------- cámara de combate

const center = () => stagePoint(ARENA);
const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _tmp = new THREE.Vector3();

/** Posición/mirada deseadas para el momento del combate. Todos los planos, en el lado sur (ver arenaLayout). */
function shot(t: number, outPos: THREE.Vector3, outLook: THREE.Vector3): 'cut' | 'smooth' {
  const b = getBattle();
  const C = center();
  const P = stagePoint(SPOT.player), F = stagePoint(SPOT.foe), T = stagePoint(SPOT.trainer);
  const hP = stage.height.player, hF = stage.height.foe;
  // Presentación: vuelo aéreo sobre las gradas bajando al campo, travelling hacia el salvaje, corte al
  // entrenador lanzando la bola, y plano general.
  if (b.turn === 'intro') {
    if (t < INTRO.dollyAt) {
      const k = ease(clamp01(t / INTRO.dollyAt));
      const ang = -Math.PI / 2 + E * (1.05 - k * 0.75);
      const r = 20.5 - k * 6;
      outPos.set(C.x + Math.cos(ang) * r, C.y + 14 - k * 7.5, C.z + Math.sin(ang) * r);
      outLook.set(C.x - E * k * 1.2, C.y + 1 + (1 - k) * 1.5, C.z);
      return t < 0.05 ? 'cut' : 'smooth';
    }
    if (t < INTRO.trainerAt) {
      const k = ease(clamp01((t - INTRO.dollyAt) / (INTRO.trainerAt - INTRO.dollyAt)));
      outPos.set(F.x + E * (4.6 - k * 1.6), F.y + 0.9 + k * 0.5, F.z - 5.2 + k * 1.4);
      outLook.set(F.x, F.y + hF * 0.55, F.z);
      return t < INTRO.dollyAt + 0.05 ? 'cut' : 'smooth';
    }
    if (t < INTRO.trainerAt + 0.7) {
      outPos.set(T.x + E * 1.6, T.y + 1.9, T.z - 2.9);
      outLook.set(P.x - E * 0.6, P.y + 0.6, P.z);
      return t < INTRO.trainerAt + 0.05 ? 'cut' : 'smooth';
    }
  }
  // Fin: órbita lenta alrededor del ganador (siempre por el lado sur).
  if (b.turn === 'over' && b.result !== 'flee') {
    const W = b.result === 'win' ? P : F;
    const hW = b.result === 'win' ? hP : hF;
    // Del lado contrario al entrenador, para que no se meta entre la cámara y el ganador.
    const ang = -Math.PI / 2 - E * 0.45 + Math.sin(t * 0.25) * 0.4;
    const r = 3.4 + hW;
    outPos.set(W.x + Math.cos(ang) * r, W.y + 1.1 + hW * 0.5, W.z + Math.sin(ang) * r);
    outLook.set(W.x, W.y + hW * 0.55, W.z);
    return 'smooth';
  }
  const a = b.anim;
  // Golpe final: corte a un primer plano lateral del que cae, acercándose despacio durante la cámara lenta.
  if (a && a.ko && a.phase === 'impact') {
    const tgt = other(a.by);
    const T = tgt === 'player' ? P : F, A = tgt === 'player' ? F : P;
    const h = stage.height[tgt];
    const push = clamp01(1 - stage.slow / 1.5);
    outPos.set(T.x + (A.x - T.x) * 0.3, T.y + 0.45 + h * 0.3, T.z - (3.4 + h * 0.8 - push * 0.8));
    outLook.set(T.x, T.y + h * 0.48, T.z);
    return 'cut';
  }
  // Ataque en curso: por encima del hombro del atacante.
  if (a && a.by === 'player') {
    outPos.set(P.x + E * (2.2 + hP * 0.4), P.y + 1.4 + hP * 0.5, P.z - 3.0 - hP * 0.3);
    outLook.set(F.x, F.y + hF * 0.5, F.z);
    return 'smooth';
  }
  if (a && a.by === 'foe') {
    outPos.set(F.x - E * (2.4 + hF * 0.4), F.y + 1.5 + hF * 0.5, F.z - 3.3 - hF * 0.3);
    outLook.set(P.x, P.y + hP * 0.5, P.z);
    return 'smooth';
  }
  // Plano general: los dos combatientes, el del jugador más cerca, con respiración lenta.
  const sway = Math.sin(t * 0.35) * 0.5;
  outPos.set(C.x + E * 6.2 + sway, C.y + 2.9 + Math.max(hP, hF) * 0.35, C.z - 6.6);
  outLook.set(C.x - E * 0.9, C.y + 0.95, C.z + 0.4);
  return 'smooth';
}

const BattleCamera: React.FC = () => {
  const { camera } = useThree();
  const lookNow = useRef(new THREE.Vector3());
  const lastCutKey = useRef('');
  const baseFov = useRef(0);
  useFrame((_, dtRaw) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!inArena()) {
      if (baseFov.current) { cam.fov = baseFov.current; cam.updateProjectionMatrix(); baseFov.current = 0; }
      return;
    }
    const dt = Math.min(dtRaw, 0.05);
    // Golpe de zoom: cierra el plano de golpe y lo suelta despacio.
    if (!baseFov.current) baseFov.current = cam.fov;
    stage.kick = Math.max(0, stage.kick - dt * 2.4);
    const fov = baseFov.current * (1 - 0.12 * stage.kick * stage.kick);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const t = stage.t;
    const mode = shot(t, _pos, _look);
    const an = getBattle().anim;
    const key = an?.ko && an.phase === 'impact' ? `ko${an.id}` : `${getBattle().turn}:${t < INTRO.dollyAt ? 0 : t < INTRO.trainerAt ? 1 : t < INTRO.trainerAt + 0.7 ? 2 : 3}`;
    if (camCtl.cut || (mode === 'cut' && key !== lastCutKey.current)) {
      camCtl.cut = false;
      lastCutKey.current = key;
      camera.position.copy(_pos);
      lookNow.current.copy(_look);
    } else {
      camera.position.lerp(_pos, 1 - Math.exp(-dt * 3.2));
      lookNow.current.lerp(_look, 1 - Math.exp(-dt * 4.5));
    }
    // Sacudida del impacto: decae rápido, más fuerte en golpes súper eficaces.
    stage.shake = Math.max(0, stage.shake - dt * 1.4);
    const sh = stage.shake * stage.shake;
    _tmp.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    camera.position.add(_tmp);
    camera.lookAt(lookNow.current);
  });
  return null;
};

// ---------------------------------------------------------------- escenario completo

/** Luz de relleno del estadio: mantiene legibles a los combatientes a cualquier hora (de noche incluida). */
const StageLights: React.FC = () => {
  const C = center();
  return (
    <>
      <pointLight position={[C.x - 3, C.y + 5, C.z - 4]} intensity={9} distance={16} decay={1.6} color={0xfff1d6} />
      <pointLight position={[C.x + 3.5, C.y + 4, C.z + 3]} intensity={5} distance={14} decay={1.6} color={0xd6e6ff} />
    </>
  );
};

const BattleStage: React.FC = () => {
  const b = useBattle();
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    if (stage.freeze > 0) { stage.freeze -= dt; stage.speed = 0.03; }
    else if (stage.slow > 0) {
      stage.slow = Math.max(0, stage.slow - dt);
      // 0.22× casi todo el rato; los últimos 0.4 s recupera la velocidad normal.
      stage.speed = stage.slow > 0.4 ? 0.22 : 1 - 0.78 * (stage.slow / 0.4);
    } else stage.speed = 1;
    stage.t += dt * stage.speed;
  });
  useEffect(() => {
    stage.t = 0; stage.shake = 0; stage.kick = 0; stage.speed = 1; stage.freeze = 0; stage.slow = 0;
    stagePoint(SPOT.player, 0, stage.pos.player);
    stagePoint(SPOT.foe, 0, stage.pos.foe);
  }, []);
  if (!b.playerSpecies || !b.foeSpecies) return null;
  return (
    <>
      <StageLights />
      <Suspense fallback={null}>
        <Fighter side="foe" model={b.fModel} look={b.fLook} species={b.foeSpecies} enterAt={INTRO.foeAt} />
      </Suspense>
      <Suspense fallback={null}>
        <Fighter side="player" model={b.pModel} look={b.pLook} species={b.playerSpecies} enterAt={INTRO.ballEnd} />
      </Suspense>
      <AttackFx />
      <DamagePopups />
    </>
  );
};

/** Monta el combate 3D solo mientras la vista está en el estadio; la cámara de combate siempre escucha. */
export const BattleArena: React.FC = () => {
  const b = useBattle();
  const show = b.active && b.view === 'arena';
  return (
    <>
      <BattleCamera />
      {show && <BattleStage />}
    </>
  );
};
