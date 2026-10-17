// La bola de captura en 3D, portada de research/pokegrass-source/js/ball.js (dos hemisferios, banda y
// botón, color por tipo de bola) y convertida en el director de toda la animación de captura: lanzamiento
// en arco con estela, impacto, tapa que se abre con bisagra, rayo de energía, el monstruo hecho luz entrando
// (capFx → Monsters), caída con rebote y polvo, temblores con pausa, y el clic con estrellas — o el
// reventón con el monstruo saliendo enfadado. Los plazos vienen de capture/timing (los mismos que espera
// captureStore), y el tiempo de fase se mide con el reloj real para no desincronizarse si bajan los FPS.
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BALLS, surfaceY } from './species';
import { useCapture, type Phase } from './captureStore';
import { spawnById, playerPos } from './wildStore';
import { toonMaterial } from './toon';
import { sfx } from '../audio/sound';
import { capFx } from './capture/fxState';
import { capStyle } from './capture/style';
import { Particles, Shape, Mode, pick } from './capture/particles';
import { Beam, Flashes } from './capture/fxMeshes';
import { THROW_MS, AB, DROP_MS, WOBBLE_MS, SWING_MS } from './capture/timing';

const R = 0.28;

interface BallParts {
  group: THREE.Group; lid: THREE.Group; btn: THREE.MeshToonMaterial; light: THREE.MeshBasicMaterial; mats: THREE.Material[]; geos: THREE.BufferGeometry[];
}
function makeBall(color: number, gold: boolean): BallParts {
  const g = new THREE.Group();
  const topMat = toonMaterial(color, { rim: gold ? 0.3 : 0.18, soft: true });
  const botMat = toonMaterial(0xf6f7fb, { rim: 0.12, soft: true });
  const bandMat = toonMaterial(0x1a2330, { rim: 0.05, soft: true });
  const btnMat = toonMaterial(0xf4f6fb, { rim: 0.1, emissive: 0x333333, soft: true });
  // Luz del interior: se ve por la boca cuando la tapa se abre.
  const light = new THREE.MeshBasicMaterial({ color: 0xcfe9ff, side: THREE.DoubleSide });
  const topGeo = new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const botGeo = new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const bandGeo = new THREE.CylinderGeometry(R * 1.015, R * 1.015, R * 0.17, 32, 1, true);
  const ringGeo = new THREE.CylinderGeometry(R * 0.34, R * 0.34, R * 0.12, 24);
  const btnGeo = new THREE.CylinderGeometry(R * 0.22, R * 0.22, R * 0.16, 24);
  const discGeo = new THREE.CircleGeometry(R * 0.97, 32);
  const top = new THREE.Mesh(topGeo, topMat);
  const topIn = new THREE.Mesh(topGeo, light); topIn.scale.setScalar(0.97);
  // Bisagra atrás: el hemisferio superior gira alrededor del canto trasero, como una tapa de verdad.
  const lid = new THREE.Group(); lid.position.z = -R;
  top.position.z = R; topIn.position.z = R;
  lid.add(top, topIn);
  const bot = new THREE.Mesh(botGeo, botMat);
  const band = new THREE.Mesh(bandGeo, bandMat);
  const disc = new THREE.Mesh(discGeo, light); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002;
  const ring = new THREE.Mesh(ringGeo, bandMat); ring.rotation.x = Math.PI / 2; ring.position.z = R * 0.97;
  const btn = new THREE.Mesh(btnGeo, btnMat); btn.rotation.x = Math.PI / 2; btn.position.z = R * 1.03;
  g.add(lid, bot, band, disc, ring, btn);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== light) o.castShadow = true; });
  return { group: g, lid, btn: btnMat, light, mats: [topMat, botMat, bandMat, btnMat, light], geos: [topGeo, botGeo, bandGeo, ringGeo, btnGeo, discGeo] };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const outCubic = (k: number) => 1 - (1 - k) ** 3;
const outBack = (k: number) => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);
const WHITE = new THREE.Color(0xffffff);
const GOLD = new THREE.Color(0xffd34a);
const DUST = new THREE.Color(0xd9ceb0);
const _col = new THREE.Color();

/** Estado de la animación entre frames (vectores preasignados: nada se reserva en useFrame). */
function makeState() {
  return {
    phase: 'aim' as Phase, from: 'aim' as Phase, at: 0,
    start: new THREE.Vector3(), peak: new THREE.Vector3(), hit: new THREE.Vector3(), hover: new THREE.Vector3(),
    ground: new THREE.Vector3(), drop: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, 1),
    upright: new THREE.Quaternion(), prev: new THREE.Vector3(),
    snapped: false, landed: 0, wobble: -1, glints: 0, grumbled: false, trailAcc: 0, streamAcc: 0,
    sq: 0, sqV: 0, fovOff: 0, fovKick: 0, baseFov: 0, fovTouched: false,
  };
}

export const CaptureBall: React.FC<{ quiet?: boolean }> = ({ quiet = false }) => {
  const cap = useCapture();
  const { camera, gl } = useThree();
  const holder = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const squash = useRef<THREE.Group>(null);
  const S = useRef(makeState()).current;
  const active = !!cap.activeId;
  const spawn = spawnById(cap.activeId);
  const style = capStyle(spawn?.species.tier ?? 'Common', cap.shiny);

  const ball = useMemo(() => makeBall(BALLS[cap.ball].color, cap.ball === 'hood'), [cap.ball]);
  useEffect(() => () => { ball.mats.forEach((m) => m.dispose()); ball.geos.forEach((g) => g.dispose()); }, [ball]);
  const trailColor = useMemo(() => new THREE.Color(BALLS[cap.ball].color).lerp(WHITE, 0.45), [cap.ball]);

  const fx = useMemo(() => ({ add: new Particles(900, true), soft: new Particles(420, false), beam: new Beam(), flashes: new Flashes(8) }), []);
  useEffect(() => () => { fx.add.dispose(); fx.soft.dispose(); fx.beam.dispose(); fx.flashes.dispose(); }, [fx]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now();
    const time = now / 1000;
    fx.add.setScale(gl, camera); fx.soft.material.uniforms.uScale.value = fx.add.material.uniforms.uScale.value;
    fx.add.update(dt, time); fx.soft.update(dt, time); fx.flashes.update(dt, camera);

    const phase: Phase = active ? cap.phase : 'aim';
    const k = style.k;
    const g = holder.current, sp = spin.current, sq = squash.current;
    if (!g || !sp || !sq) return;

    // ---------- transiciones ----------
    if (phase !== S.phase) {
      const from = S.phase;
      // 'fled' tras 'broke' es la misma animación: el reventón ya está en marcha.
      const cont = phase === 'fled' && from === 'broke';
      S.from = from; S.phase = phase;
      if (!cont) { S.at = now; S.snapped = false; S.landed = 0; S.wobble = -1; S.glints = 0; S.grumbled = false; }
      if (phase === 'throw') onThrow();
      else if (phase === 'absorb' && from === 'throw') onHit();
      else if (phase === 'shake') onDrop();
      else if (phase === 'caught') onCaught();
      else if (phase === 'broke' || (phase === 'fled' && from === 'shake')) onBurst();
    }
    const t = (now - S.at) / 1000;

    // ---------- pose por fase ----------
    let visible = active && (phase === 'throw' || phase === 'absorb' || phase === 'shake' || phase === 'caught' || phase === 'broke' || phase === 'fled');
    let lidAng = 0, btnGlow = 0.2, scale = 1, lightOn = 0;
    ball.btn.emissive.setRGB(1, 1, 1);
    capFx.tint.copy(style.glow);

    if (phase === 'throw') {
      const kk = clamp01(t / (THROW_MS / 1000));
      const a = 1 - kk;
      g.position.set(
        a * a * S.start.x + 2 * a * kk * S.peak.x + kk * kk * S.hit.x,
        a * a * S.start.y + 2 * a * kk * S.peak.y + kk * kk * S.hit.y,
        a * a * S.start.z + 2 * a * kk * S.peak.z + kk * kk * S.hit.z,
      );
      sp.quaternion.setFromAxisAngle(S.right, -t * 22);
      trail(dt);
      S.fovOff = lerpExp(S.fovOff, -2.2, dt, 4);
      capFx.dissolve = 0; capFx.glow = 0; capFx.annoy = 0;
    } else if (phase === 'absorb') {
      // Rebote hacia atrás y arriba hasta el punto de vuelo, con la boca apuntando al monstruo.
      if (t < AB.hover) {
        const kk = t / AB.hover;
        g.position.lerpVectors(S.hit, S.hover, outCubic(kk)).addScaledVector(UP, Math.sin(kk * Math.PI) * 0.22);
      } else g.position.copy(S.hover).addScaledVector(UP, Math.sin(time * 3.2) * 0.035);
      if (!S.snapped) {
        _v.subVectors(capFx.rest, g.position).normalize().multiplyScalar(0.85).addScaledVector(UP, 0.35).normalize();
        _q.setFromUnitVectors(UP, _v);
      } else _q.copy(S.upright);
      sp.quaternion.slerp(_q, 1 - Math.exp(-dt * (t < AB.hover ? 7 : 12)));
      // Tapa: se abre con rebote y se cierra de golpe al final.
      const open = t < AB.open ? 0 : outBack(clamp01((t - AB.open) / 0.16));
      const close = t < AB.snap ? 0 : clamp01((t - AB.snap) / 0.07);
      lidAng = -2.0 * open * (1 - close * close);
      lightOn = open * (1 - close);
      mouth(g, sp);
      capFx.ball.copy(_mouth);
      capFx.glow = smooth(AB.glow, AB.glow + 0.2, t);
      capFx.dissolve = clamp01((t - AB.pullFrom) / (AB.pullTo - AB.pullFrom));
      capFx.annoy = 0;
      fx.add.attractor.copy(_mouth);
      // Rayo: sale de la boca, alcanza al monstruo y se apaga cuando ya casi ha entrado.
      const beamA = smooth(AB.beam, AB.beam + 0.06, t) * (1 - smooth(0.78, 0.95, t));
      fx.beam.set(_mouth, capFx.body, capFx.size * 0.42 * (1 - 0.6 * capFx.dissolve) + 0.08, beamA * 0.9, clamp01((t - AB.beam) / 0.1), time, style.glow);
      if (t > AB.glow && t < AB.pullTo) stream(dt, t);
      if (!S.snapped && t >= AB.snap) {
        S.snapped = true;
        sfx.capSnap();
        fx.flashes.fire(_mouth, style.glow, 0.2, 1.1, 0.28, false, false, 0.9);
        for (let i = 0; i < 14 * k; i++) sparkOut(_mouth, 1.4, 0.45, Shape.Sparkle, 0.2);
        S.sqV = -3.2;
      }
      btnGlow = S.snapped ? 0.35 + 0.25 * Math.sin(time * 6) : 0.2;
      if (S.snapped) ball.btn.emissive.copy(style.glow);
      S.fovOff = lerpExp(S.fovOff, -3, dt, 3);
    } else if (phase === 'shake') {
      capFx.dissolve = 1; capFx.glow = 1; capFx.annoy = 0;
      fx.beam.hide();
      const fall = 0.3;
      if (t < fall) {
        const kk = t / fall;
        g.position.copy(S.drop).setY(S.drop.y + (S.ground.y - S.drop.y) * kk * kk);
        sp.quaternion.slerp(S.upright, 1 - Math.exp(-dt * 9));
      } else {
        if (S.landed === 0) { S.landed = 1; land(false); }
        const b = t - fall, bd = DROP_MS / 1000 - fall;
        g.position.copy(S.ground);
        if (b < bd) g.position.y += Math.sin((b / bd) * Math.PI) * 0.13;
        else if (S.landed === 1) { S.landed = 2; land(true); }
        sp.quaternion.slerp(S.upright, 1 - Math.exp(-dt * 14));
      }
      // Temblores: vaivén rodando sobre el punto de apoyo, pausa en silencio, y el botón se enciende en cada uno.
      const tw = t - DROP_MS / 1000;
      if (tw >= 0) {
        const i = Math.floor(tw / (WOBBLE_MS / 1000));
        const c = (tw - (i * WOBBLE_MS) / 1000) / (SWING_MS / 1000);
        if (i !== S.wobble) {
          S.wobble = i;
          sfx.capWobble(i);
          for (let j = 0; j < 3; j++) puff(S.ground, 0.5, 0.1, 0.22);
        }
        if (c < 1) {
          const sgn = i % 2 ? -1 : 1;
          const ang = sgn * Math.sin(c * Math.PI * 2) * (0.5 + 0.07 * i) * (1 - c * 0.45);
          g.position.copy(S.ground).addScaledVector(S.right, -ang * R);
          g.position.y += Math.abs(Math.sin(c * Math.PI * 2)) * 0.012;
          sp.quaternion.copy(S.upright).multiply(_qz.setFromAxisAngle(_Z, ang));
          btnGlow = 0.3 + 1.7 * Math.sin(c * Math.PI);
        } else btnGlow = 0.08;
        ball.btn.emissive.copy(style.glow).lerp(WHITE, 0.25);
        S.fovOff = lerpExp(S.fovOff, -3.6 - Math.min(3, i) * 0.45, dt, 2);
      } else S.fovOff = lerpExp(S.fovOff, -3.2, dt, 3);
    } else if (phase === 'caught') {
      capFx.dissolve = 1; capFx.glow = 1;
      g.position.copy(S.ground);
      if (t < 0.28) g.position.y += Math.sin((t / 0.28) * Math.PI) * 0.12;
      else if (S.landed < 3) { S.landed = 3; S.sqV = -2.4; }
      sp.quaternion.slerp(S.upright, 1 - Math.exp(-dt * 14));
      ball.btn.emissive.copy(GOLD);
      btnGlow = 0.9 + 0.5 * Math.exp(-t * 3) + Math.sin(time * 7) * 0.15;
      // Destellos del brillo de la bola.
      const glintAt = [0.45, 1.05, 1.7];
      if (S.glints < glintAt.length && t >= glintAt[S.glints]) {
        S.glints++;
        _v.copy(S.ground).addScaledVector(UP, R * 0.75).addScaledVector(S.right, -R * 0.55).addScaledVector(S.back, R * 0.9);
        fx.add.emit(_v.x, _v.y, _v.z, 0, 0, 0, 0.42, 0.85, 0.05, WHITE, Shape.Sparkle, 0, 0, Mode.Free, 2.5);
      }
      S.fovOff = lerpExp(S.fovOff, t < 0.5 ? -2 : 0, dt, 2.5);
    } else if (phase === 'broke' || phase === 'fled') {
      fx.beam.hide();
      // La bola salta, con la tapa abierta de golpe, y se deshace en chispas.
      g.position.copy(S.ground).addScaledVector(UP, Math.sin(clamp01(t / 0.4) * Math.PI) * 0.3);
      lidAng = -2.3 * clamp01(t / 0.08);
      lightOn = 1 - clamp01(t / 0.4);
      scale = 1 - smooth(0.22, 0.5, t);
      if (scale <= 0.01) visible = false;
      capFx.ball.copy(S.ground).addScaledVector(UP, R);
      capFx.dissolve = 1 - outCubic(clamp01((t - 0.05) / 0.5));
      capFx.glow = 1 - smooth(0.35, 0.85, t);
      capFx.annoy = t > 0.62 ? Math.sin(clamp01((t - 0.62) / 0.55) * Math.PI) : 0;
      if (!S.grumbled && t > 0.62) {
        S.grumbled = true;
        sfx.capGrumble();
        for (let i = 0; i < 3; i++) {
          _v.copy(capFx.rest).addScaledVector(UP, capFx.size * 0.55).addScaledVector(S.right, (i - 1) * capFx.size * 0.32);
          fx.soft.emit(_v.x, _v.y, _v.z, (i - 1) * 0.5, 0.9, 0, 0.6, capFx.size * 0.12 + 0.08, capFx.size * 0.2 + 0.2, WHITE, Shape.Puff, -0.5, 2);
        }
      }
      S.fovOff = lerpExp(S.fovOff, 0, dt, 2.5);
    } else {
      // Sin animación: si el tiro falló a medias (error del servidor), el monstruo vuelve a su forma.
      capFx.dissolve = lerpExp(capFx.dissolve, 0, dt, 8);
      capFx.glow = lerpExp(capFx.glow, 0, dt, 6);
      capFx.annoy = 0;
      fx.beam.hide();
      S.fovOff = lerpExp(S.fovOff, 0, dt, 3);
    }

    g.visible = visible && !quiet;
    if (quiet) {
      fx.beam.hide();
      fx.add.points.visible = false;
      fx.soft.points.visible = false;
      fx.flashes.group.visible = false;
    } else {
      fx.add.points.visible = true;
      fx.soft.points.visible = true;
      fx.flashes.group.visible = true;
    }
    ball.lid.rotation.x = lidAng;
    ball.btn.emissiveIntensity = btnGlow;
    ball.light.color.copy(style.glow).lerp(WHITE, 0.35).multiplyScalar(0.4 + 0.6 * lightOn);
    // Muelle de aplastamiento (golpes y aterrizajes).
    S.sqV += (-260 * S.sq - 16 * S.sqV) * dt;
    S.sq += S.sqV * dt;
    sq.scale.set(scale * (1 - S.sq * 0.5), scale * (1 + S.sq), scale * (1 - S.sq * 0.5));

    // Énfasis de cámara: un leve zoom durante el tiro y la tensión, y golpes cortos en impactos.
    S.fovKick = lerpExp(S.fovKick, 0, dt, 7);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera && !quiet) {
      if (!S.fovTouched) S.baseFov = cam.fov;
      const off = S.fovOff + S.fovKick;
      if (Math.abs(off) > 0.01) {
        S.fovTouched = true;
        cam.fov = S.baseFov + off; cam.updateProjectionMatrix();
      } else if (S.fovTouched) {
        S.fovTouched = false;
        cam.fov = S.baseFov; cam.updateProjectionMatrix();
      }
    }
  });

  // ---------- eventos ----------
  function onThrow() {
    camera.getWorldDirection(_v);
    S.right.crossVectors(_v, UP).normalize();
    const py = surfaceY(playerPos.x, playerPos.z);
    S.start.set(playerPos.x, py + 1.3, playerPos.z).addScaledVector(S.right, 0.32);
    S.back.set(playerPos.x - capFx.rest.x, 0, playerPos.z - capFx.rest.z);
    if (S.back.lengthSq() < 1e-4) S.back.set(-_v.x, 0, -_v.z);
    S.back.normalize();
    S.hit.copy(capFx.rest).addScaledVector(S.back, capFx.size * 0.28).addScaledVector(UP, capFx.size * 0.05);
    const dist = S.start.distanceTo(S.hit);
    S.peak.copy(S.start).lerp(S.hit, 0.5).addScaledVector(UP, 0.9 + dist * 0.14).addScaledVector(S.right, dist * 0.05);
    S.hover.copy(S.hit).addScaledVector(S.back, 0.85 + capFx.size * 0.22).addScaledVector(UP, 0.6 + capFx.size * 0.22);
    S.prev.copy(S.start);
    S.trailAcc = 0;
    spin.current?.quaternion.identity();
    sfx.capThrow();
  }
  function onHit() {
    const at = S.hit;
    sfx.capOpen();
    fx.flashes.fire(at, WHITE, 0.3, 1.2 + capFx.size * 0.9, 0.3, false, false, 1);
    fx.flashes.fire(at, style.glow, 0.25, 1.4 + capFx.size, 0.5, true);
    for (let i = 0; i < 26 * style.k; i++) sparkOut(at, 3.2, 0.55, Math.random() < 0.3 ? Shape.Sparkle : Shape.Glow, 0.16);
    S.fovKick = -1.2;
    S.sqV = 4;
    S.streamAcc = 0;
    fx.beam.hide();
  }
  function onDrop() {
    const g = holder.current!;
    S.drop.copy(g.position);
    S.ground.set(g.position.x, surfaceY(g.position.x, g.position.z) + R, g.position.z);
    uprightFacingCamera();
  }
  function onCaught() {
    uprightFacingCamera();
    sfx.capClick();
    const c = _w.copy(S.ground).addScaledVector(UP, R * 0.6);
    const k = style.k;
    fx.flashes.fire(c, GOLD, 0.3, 1.6, 0.35, false, false, 0.8);
    fx.flashes.fire(_v.copy(S.ground).setY(S.ground.y - R + 0.03), GOLD, 0.3, 2.6, 0.7, true, true, 0.9);
    for (let i = 0; i < 14 * k; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.4 + Math.random() * 1.8;
      fx.soft.emit(c.x, c.y, c.z, Math.cos(a) * s, 2.4 + Math.random() * 2.2, Math.sin(a) * s, 1.0 + Math.random() * 0.4,
        0.2 + Math.random() * 0.12, 0.1, i % 3 ? GOLD : pick(style.accents), Shape.Star, 5.5, 1.2, Mode.Free, (Math.random() - 0.5) * 8);
    }
    for (let i = 0; i < 36 * k; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.4;
      fx.soft.emit(c.x, c.y, c.z, Math.cos(a) * s, 3 + Math.random() * 2.6, Math.sin(a) * s, 1.3 + Math.random() * 0.6,
        0.1 + Math.random() * 0.05, 0.09, pick(style.accents), Shape.Confetti, 6.5, 2.4, Mode.Free, (Math.random() - 0.5) * 22);
    }
    for (let i = 0; i < 26 * k; i++) sparkOut(c, 2.8, 0.7, Shape.Sparkle, 0.26);
    // Estrellitas girando alrededor de la bola.
    fx.soft.attractor.copy(S.ground);
    for (let i = 0; i < style.orbit; i++) {
      fx.soft.emit(0, 0, 0, 0.4, 3.4, 0.42 + (i % 2) * 0.08, 3.2, 0.17, 0.13, i % 2 ? GOLD : pick(style.accents), Shape.Star, 0, (i / style.orbit) * Math.PI * 2, Mode.Orbit, 3);
    }
    S.sqV = -3.5;
    S.fovKick = -0.8;
  }
  function onBurst() {
    const c = _w.copy(S.ground).addScaledVector(UP, R);
    sfx.capBurst();
    fx.flashes.fire(c, WHITE, 0.4, 2.2 + capFx.size, 0.34, false, false, 1);
    fx.flashes.fire(c, style.glow, 0.3, 2.4 + capFx.size, 0.55, true);
    for (let i = 0; i < 34 * style.k; i++) sparkOut(c, 4, 0.6, Math.random() < 0.35 ? Shape.Sparkle : Shape.Glow, 0.18);
    // La luz vuelve al monstruo: chispas atraídas hacia su centro.
    fx.add.attractor.copy(capFx.rest);
    for (let i = 0; i < 46 * style.k; i++) {
      _col.copy(style.glow).lerp(WHITE, Math.random() * 0.5);
      fx.add.emit(c.x, c.y, c.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.55 + Math.random() * 0.3,
        0.18, 0.06, _col, Shape.Glow, 0, 0, Mode.Seek);
    }
    S.fovKick = 1.4;
    S.sqV = 3;
  }

  // ---------- ayudantes ----------
  function uprightFacingCamera() {
    const p = holder.current!.position;
    S.upright.setFromAxisAngle(UP, Math.atan2(camera.position.x - p.x, camera.position.z - p.z));
    camera.getWorldDirection(_v);
    S.right.crossVectors(_v, UP).normalize();
    S.back.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
  }
  function mouth(g: THREE.Group, sp: THREE.Group) {
    _mouth.set(0, R * 0.25, 0).applyQuaternion(sp.quaternion).add(g.position);
  }
  function sparkOut(at: THREE.Vector3, speed: number, life: number, shape: 0 | 1, size: number) {
    const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.35 + Math.random() * 0.65);
    const r = Math.sqrt(1 - u * u);
    _col.copy(Math.random() < 0.5 ? style.glow : pick(style.accents));
    fx.add.emit(at.x, at.y, at.z, Math.cos(a) * r * s, Math.abs(u) * s * 0.9 + 0.4, Math.sin(a) * r * s, life * (0.7 + Math.random() * 0.6),
      size * (0.7 + Math.random() * 0.6), 0.02, _col, shape, 2.2, 2.6, Mode.Free, (Math.random() - 0.5) * 6);
  }
  function puff(at: THREE.Vector3, speed: number, size0: number, size1: number) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.5 + Math.random() * 0.8);
    fx.soft.emit(at.x + Math.cos(a) * R * 0.8, at.y - R + 0.04, at.z + Math.sin(a) * R * 0.8, Math.cos(a) * s, 0.25 + Math.random() * 0.3, Math.sin(a) * s,
      0.5 + Math.random() * 0.25, size0, size1, DUST, Shape.Puff, 0.3, 3.5);
  }
  function land(soft: boolean) {
    sfx.capLand(soft);
    S.sqV = soft ? -1.6 : -4;
    const n = soft ? 5 : 14;
    for (let i = 0; i < n; i++) puff(S.ground, soft ? 0.8 : 1.6, 0.14, soft ? 0.3 : 0.46);
    if (!soft) {
      fx.flashes.fire(_v.copy(S.ground).setY(S.ground.y - R + 0.03), DUST, 0.3, 1.5, 0.45, true, true, 0.5);
      S.fovKick = -0.7;
    }
  }
  /** Estela del vuelo: brillos repartidos a lo largo del tramo recorrido este frame (sin huecos si bajan los FPS). */
  function trail(dt: number) {
    const p = holder.current!.position;
    const d = S.prev.distanceTo(p);
    const n = Math.min(16, Math.floor(d / 0.05));
    for (let i = 0; i < n; i++) {
      _v.lerpVectors(S.prev, p, (i + 1) / n);
      fx.add.emit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3,
        0.3 + Math.random() * 0.1, 0.34, 0.03, trailColor, Shape.Glow);
    }
    S.trailAcc += dt * 26 * style.k;
    while (S.trailAcc >= 1) {
      S.trailAcc--;
      fx.add.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.8, Math.random() * 0.4, (Math.random() - 0.5) * 0.8,
        0.5 + Math.random() * 0.3, 0.16, 0.02, pick(style.accents), Shape.Sparkle, 1.2, 1, Mode.Free, 4);
    }
    S.prev.copy(p);
  }
  /** El cuerpo hecho luz fluye a la bola: chispas nacen sobre su silueta (que encoge) y giran hacia la boca. */
  function stream(dt: number, t: number) {
    const rate = (130 + 110 * smooth(AB.pullFrom, AB.pullTo, t)) * style.k;
    S.streamAcc += dt * rate;
    const rad = capFx.size * 0.42 * (1 - 0.8 * capFx.dissolve) + 0.05;
    while (S.streamAcc >= 1) {
      S.streamAcc--;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
      const x = capFx.body.x + Math.cos(a) * r * rad, y = capFx.body.y + u * rad * 1.1, z = capFx.body.z + Math.sin(a) * r * rad;
      _col.copy(Math.random() < 0.7 ? style.glow : pick(style.accents)).lerp(WHITE, Math.random() * 0.4);
      fx.add.emit(x, y, z, Math.cos(a) * 0.8, 0.4 + Math.random() * 0.6, Math.sin(a) * 0.8, 0.9,
        0.13 + Math.random() * 0.12, 0.05, _col, Math.random() < 0.18 ? Shape.Sparkle : Shape.Glow, 0, 0, Mode.Seek, 3);
    }
  }

  return (
    <>
      <group ref={holder} visible={false}>
        <group ref={spin}>
          {/* Pivote del aplastamiento en la base: al aterrizar se chafa contra el suelo, no contra su centro. */}
          <group ref={squash} position={[0, -R, 0]}><primitive object={ball.group} position={[0, R, 0]} /></group>
        </group>
      </group>
      <primitive object={fx.beam.group} />
      <primitive object={fx.flashes.group} />
      <primitive object={fx.add.points} />
      <primitive object={fx.soft.points} />
    </>
  );
};

function lerpExp(a: number, b: number, dt: number, speed: number) {
  return b + (a - b) * Math.exp(-dt * speed);
}
