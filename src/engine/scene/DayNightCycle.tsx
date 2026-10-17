// Ciclo día/noche basado en la hora real del dispositivo.
//
// Reajustado para cel-shading. La curva anterior venía de cowork-v3 (una oficina) y tenía ambiente 0.7 +
// hemisférica 0.55 + direccional 1.2: eso suma casi toda la luz por vías que no producen sombreado
// direccional, así que la rampa de bandas del toon quedaba aplastada en una sola banda y todo se veía
// plano. Ahora el ambiente es bajo y la direccional fuerte, que es lo que hace visibles las bandas.
//
// La noche también se subió de suelo: antes caía a un gris azulado apagado. Ahora es un azul lunar
// saturado, para que abrir el juego de noche siga siendo bonito en vez de parecer un bug.
import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SUN, SKY } from '../../world/lighting';
import type { Posicion3DPlano } from '../runtime/movimiento';

interface DayNightCycleProps {
  enabled?: boolean;
  /**
   * Posición del jugador. La cámara de sombras cubre ±60 m, así que tiene que viajar con él: fija en el
   * origen (como estaba) solo hay sombras alrededor del punto de aparición y el resto de la región se ve
   * sin apoyar en el suelo.
   */
  targetRef?: React.MutableRefObject<Posicion3DPlano>;
  /** Si la luz direccional proyecta sombra. Controlado por el flag de debug para aislar el parpadeo. */
  castShadow?: boolean;
}

interface Keyframe {
  h: number;
  /** Ambiental: color e intensidad. */
  ac: string; ai: number;
  /** Direccional: color e intensidad. */
  dc: string; di: number;
  /** Hemisférica: color de cielo, color de suelo, intensidad. */
  sky: string; ground: string; hemi: number;
  /** Cúpula de cielo: cenit y horizonte. El horizonte también es el color de la niebla. */
  top: string; horizon: string;
  glow: string;
}

/** Offset de la luz respecto al jugador. Lateral y alto: da sombras largas sin aplanar las siluetas. */
const SUN_OFFSET = new THREE.Vector3(52, 74, 38);

/** Ancho del frustum de la cámara de sombras (±60, ver shadow-camera-left/right más abajo) y resolución
 * de su mapa: juntos definen cuánto mundo cubre cada texel, que es el paso de la rejilla de encaje. */
const SHADOW_FRUSTUM_SIZE = 120;
const SHADOW_MAP_RES = 2048;
const SHADOW_TEXEL = SHADOW_FRUSTUM_SIZE / SHADOW_MAP_RES;
function snapToShadowTexel(x: number, z: number): { x: number; z: number } {
  return { x: Math.round(x / SHADOW_TEXEL) * SHADOW_TEXEL, z: Math.round(z / SHADOW_TEXEL) * SHADOW_TEXEL };
}

// Recorrido del sol visible: sale a DAY0 y se pone a DAY1. El acimut pasa por el de SUN_OFFSET a
// mediodía (ahí disco y sombras coinciden) y por la tarde gira hacia +z, que es hacia donde mira la
// cámara por defecto: el atardecer queda delante del jugador.
const DAY0 = 6.2, DAY1 = 19.1;
const NOON_AZ = Math.atan2(SUN_OFFSET.x, SUN_OFFSET.z);
function celestial(hour: number, maxElev: number, azOffset: number, out: THREE.Vector3): number {
  const len = DAY1 - DAY0;
  const s = hour >= DAY0 && hour <= DAY1
    ? Math.sin(Math.PI * (hour - DAY0) / len)
    : -Math.sin(Math.PI * ((hour - DAY1 + 24) % 24) / (24 - len));
  const el = s * maxElev;
  const az = NOON_AZ + (DAY0 + len / 2 - hour) * 0.17 + azOffset;
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  return s;
}

export const DayNightCycle: React.FC<DayNightCycleProps> = ({ enabled = true, targetRef, castShadow = false }) => {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);

  const curAmbient = useRef(new THREE.Color('#a8c4d8'));
  const curDir = useRef(new THREE.Color('#fff6e0'));
  const curSky = useRef(new THREE.Color('#bfe4ff'));
  const curGround = useRef(new THREE.Color('#4e7a46'));
  const curTop = useRef(new THREE.Color('#3f86dd'));
  const curHorizon = useRef(new THREE.Color('#c3e7ff'));
  const curGlow = useRef(new THREE.Color('#2e2a20'));
  const curAi = useRef(0.42);
  const curDi = useRef(1.6);
  const curHemi = useRef(0.5);
  const initialized = useRef(false);

  // Cada franja cálida lleva la ambiental fría (lila/azul) a propósito: luz dorada con sombras violetas
  // es lo que se lee como atardecer; con ambiente también cálido todo se tiñe de un marrón turbio.
  // `glow` es lo que la niebla suma mirando hacia el sol (ver world/atmo/fog.ts): negro = nada.
  const timeConfig = useMemo<Keyframe[]>(() => [
    { h: 0, ac: '#56689f', ai: 0.38, dc: '#8fa8ee', di: 0.62, sky: '#2a3a70', ground: '#1c2c48', hemi: 0.42, top: '#070c26', horizon: '#26386a', glow: '#000000' },
    { h: 5, ac: '#56689f', ai: 0.38, dc: '#8fa8ee', di: 0.62, sky: '#2a3a70', ground: '#1c2c48', hemi: 0.42, top: '#070c26', horizon: '#26386a', glow: '#000000' },
    { h: 5.8, ac: '#7a78a6', ai: 0.4, dc: '#c9a6d8', di: 0.72, sky: '#7a74a8', ground: '#2e3a4a', hemi: 0.45, top: '#2c3a78', horizon: '#b590a8', glow: '#40241c' },
    { h: 6.8, ac: '#a09ab8', ai: 0.42, dc: '#ffc690', di: 1.1, sky: '#f0c4b0', ground: '#56604a', hemi: 0.5, top: '#5a7cc4', horizon: '#f2c4ae', glow: '#a4582a' },
    { h: 8, ac: '#a0bcd6', ai: 0.42, dc: '#ffdcaa', di: 1.45, sky: '#a6d8f5', ground: '#50784a', hemi: 0.5, top: '#4a8ad8', horizon: '#bfe2f8', glow: '#4a3a26' },
    { h: 10, ac: '#a2c0de', ai: 0.42, dc: '#fff2d8', di: 1.65, sky: '#bfe4ff', ground: '#557a44', hemi: 0.5, top: '#3a80dc', horizon: '#c6e8ff', glow: '#2e2a20' },
    { h: 14, ac: '#a2c0de', ai: 0.42, dc: '#fff2d8', di: 1.65, sky: '#bfe4ff', ground: '#557a44', hemi: 0.5, top: '#3a80dc', horizon: '#c6e8ff', glow: '#2e2a20' },
    { h: 16, ac: '#a3bccd', ai: 0.42, dc: '#ffd9a2', di: 1.5, sky: '#aadcf8', ground: '#557a44', hemi: 0.5, top: '#4486d6', horizon: '#c9e4f4', glow: '#4a3a24' },
    { h: 17.5, ac: '#a4a8c8', ai: 0.42, dc: '#ffc98a', di: 1.3, sky: '#dcc8cc', ground: '#56604a', hemi: 0.5, top: '#4c70bc', horizon: '#d8cccc', glow: '#9a5a26' },
    { h: 18.6, ac: '#9a98c4', ai: 0.42, dc: '#ffb880', di: 1.05, sky: '#d0b0c0', ground: '#4a5048', hemi: 0.5, top: '#42549e', horizon: '#c8a8bc', glow: '#d8702c' },
    { h: 19.4, ac: '#7a78b0', ai: 0.4, dc: '#c89ac8', di: 0.75, sky: '#8a78b0', ground: '#2e3450', hemi: 0.46, top: '#2a306c', horizon: '#9a80a6', glow: '#7a2e2a' },
    { h: 20.5, ac: '#5a6aa4', ai: 0.39, dc: '#93aaee', di: 0.62, sky: '#34407a', ground: '#1e2e4c', hemi: 0.43, top: '#0e1434', horizon: '#2e3c70', glow: '#08040c' },
    { h: 22, ac: '#56689f', ai: 0.38, dc: '#8fa8ee', di: 0.62, sky: '#2a3a70', ground: '#1c2c48', hemi: 0.42, top: '#070c26', horizon: '#26386a', glow: '#000000' },
    { h: 24, ac: '#56689f', ai: 0.38, dc: '#8fa8ee', di: 0.62, sky: '#2a3a70', ground: '#1c2c48', hemi: 0.42, top: '#070c26', horizon: '#26386a', glow: '#000000' },
  ], []);

  // La direccional apunta a un objeto que movemos nosotros, no al origen implícito.
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (directionalRef.current) directionalRef.current.target = sunTarget;
  }, [sunTarget]);

  useFrame(() => {
    if (!enabled || !ambientRef.current || !directionalRef.current) return;

    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;

    let idx = 0;
    for (let i = 0; i < timeConfig.length - 1; i++) {
      if (hour >= timeConfig[i].h && hour < timeConfig[i + 1].h) { idx = i; break; }
    }
    const prev = timeConfig[idx];
    const next = timeConfig[idx + 1];
    const t = (hour - prev.h) / (next.h - prev.h);

    const targetAc = new THREE.Color(prev.ac).lerp(new THREE.Color(next.ac), t);
    const targetDc = new THREE.Color(prev.dc).lerp(new THREE.Color(next.dc), t);
    const targetSky = new THREE.Color(prev.sky).lerp(new THREE.Color(next.sky), t);
    const targetGround = new THREE.Color(prev.ground).lerp(new THREE.Color(next.ground), t);
    const targetTop = new THREE.Color(prev.top).lerp(new THREE.Color(next.top), t);
    const targetHorizon = new THREE.Color(prev.horizon).lerp(new THREE.Color(next.horizon), t);
    const targetGlow = new THREE.Color(prev.glow).lerp(new THREE.Color(next.glow), t);
    const targetAi = THREE.MathUtils.lerp(prev.ai, next.ai, t);
    const targetDi = THREE.MathUtils.lerp(prev.di, next.di, t);
    const targetHemi = THREE.MathUtils.lerp(prev.hemi, next.hemi, t);

    if (!initialized.current) {
      curAmbient.current.copy(targetAc);
      curDir.current.copy(targetDc);
      curSky.current.copy(targetSky);
      curGround.current.copy(targetGround);
      curTop.current.copy(targetTop);
      curHorizon.current.copy(targetHorizon);
      curGlow.current.copy(targetGlow);
      curAi.current = targetAi;
      curDi.current = targetDi;
      curHemi.current = targetHemi;
      initialized.current = true;
    } else {
      const k = 0.02;
      curAmbient.current.lerp(targetAc, k);
      curDir.current.lerp(targetDc, k);
      curSky.current.lerp(targetSky, k);
      curGround.current.lerp(targetGround, k);
      curTop.current.lerp(targetTop, k);
      curHorizon.current.lerp(targetHorizon, k);
      curGlow.current.lerp(targetGlow, k);
      curAi.current = THREE.MathUtils.lerp(curAi.current, targetAi, k);
      curDi.current = THREE.MathUtils.lerp(curDi.current, targetDi, k);
      curHemi.current = THREE.MathUtils.lerp(curHemi.current, targetHemi, k);
    }

    ambientRef.current.color.copy(curAmbient.current);
    ambientRef.current.intensity = curAi.current;
    directionalRef.current.color.copy(curDir.current);
    directionalRef.current.intensity = curDi.current;
    if (hemiRef.current) {
      hemiRef.current.color.copy(curSky.current);
      hemiRef.current.groundColor.copy(curGround.current);
      hemiRef.current.intensity = curHemi.current;
    }

    // La luz y su objetivo viajan con el jugador para que la cámara de sombras siempre lo contenga.
    const p = targetRef?.current;
    if (p) {
      // Encajar en la rejilla de texeles del mapa de sombras, no en la posición exacta del jugador.
      // El frustum de sombra mide 120 m (±60) sobre un mapa de 2048 px: cada texel cubre ~5.9 cm de
      // mundo. Sin este ajuste el frustum se desliza en pasos continuos de fracción de milímetro cada
      // frame, y la comparación de profundidad del shadow map se vuelve inestable en cada borde de
      // sombra — se ve como un parpadeo blanco (la banda más clara de la rampa toon, sin degradado que
      // lo disimule) recorriendo el suelo y la hierba con cualquier movimiento, por pequeño que sea.
      // Encajar la posición de la luz a pasos de un texel elimina el deslizamiento sub-texel sin mover
      // el frustum de forma perceptible.
      const snapped = snapToShadowTexel(p.x, p.z);
      sunTarget.position.set(snapped.x, 0, snapped.z);
      sunTarget.updateMatrixWorld();
      directionalRef.current.position.set(snapped.x + SUN_OFFSET.x, SUN_OFFSET.y, snapped.z + SUN_OFFSET.z);
    }

    SUN.color.copy(curDir.current);
    SUN.intensity = curDi.current;
    SUN.ambient.copy(curAmbient.current);
    SUN.ambientIntensity = curAi.current;
    SKY.top.copy(curTop.current);
    SKY.horizon.copy(curHorizon.current);
    SKY.fog.copy(curHorizon.current);
    SKY.glow.copy(curGlow.current);
    const e = celestial(hour, 0.87, 0, SKY.sunDir);
    celestial((hour + 12) % 24, 0.62, -1.0, SKY.moonDir);
    SKY.night = THREE.MathUtils.smoothstep(-e, -0.05, 0.2);
    SKY.golden = THREE.MathUtils.smoothstep(-e, -0.5, -0.1) * THREE.MathUtils.smoothstep(e, -0.15, 0.02);
  });

  if (!enabled) return null;

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.42} color="#a8c4d8" />
      <hemisphereLight ref={hemiRef} args={['#bfe4ff', '#4e7a46', 0.5]} />
      <directionalLight
        ref={directionalRef}
        position={[SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z]}
        intensity={1.65}
        color="#fff6e0"
        castShadow={castShadow}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-normalBias={0.35}
        shadow-bias={-0.0004}
      />
      <primitive object={sunTarget} />
    </>
  );
};
