// Estallido de impacto estilo cómic sobre el golpeado: una estrella plana de bordes duros y un abanico de
// trazos radiales del color del tipo, siempre de cara a la cámara. Dos mallas fijas (la estrella y los
// trazos instanciados) movidas solo con uniforms: nada se crea por frame. Va con el tiempo REAL, no el del
// estadio, para que se vea entera durante la pausa de impacto.
import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const STREAKS = 14;

/** Disparo compartido: AttackFx lo rellena en el impacto y ImpactBurst lo reproduce. */
export const impact = { t: 99, at: new THREE.Vector3(), c1: new THREE.Color(), c2: new THREE.Color(), size: 1, crit: false };
export function triggerImpact(at: THREE.Vector3, c1: number, c2: number, size: number, crit: boolean) {
  impact.t = 0; impact.at.copy(at); impact.c1.setHex(c1); impact.c2.setHex(crit ? 0xffe066 : c2); impact.size = size; impact.crit = crit;
}

// Billboard en espacio de vista: el centro se proyecta y el quad se abre en el plano de la pantalla.
const VERT = `
  uniform vec3 uAt; uniform float uT; uniform float uSize;
  attribute float aAng; attribute float aLen;
  varying vec2 vUv; varying float vK;
  void main(){
    vUv = uv;
    vec4 c = viewMatrix * vec4(uAt, 1.0);
    #ifdef STREAK
      float k = clamp(uT / 0.34, 0.0, 1.0);
      float e = 1.0 - pow(1.0 - k, 3.0);
      vec2 d = vec2(cos(aAng), sin(aAng));
      vec2 n = vec2(-d.y, d.x);
      float r0 = mix(0.25, 1.35, e) * uSize;
      float len = aLen * (1.0 - k * 0.85) * uSize;
      float w = 0.07 * uSize * (1.0 - k);
      vec2 p = d * (r0 + position.y * len) + n * position.x * w * (1.0 - position.y);
      vK = k;
    #else
      float k = clamp(uT / 0.26, 0.0, 1.0);
      float s = uSize * (0.55 + 0.9 * (1.0 - pow(1.0 - k, 4.0)));
      vec2 p = position.xy * s * 2.2;
      vK = k;
    #endif
    c.xy += p;
    gl_Position = projectionMatrix * c;
  }`;

const FRAG = `
  uniform vec3 uC1; uniform vec3 uC2; uniform float uT;
  varying vec2 vUv; varying float vK;
  void main(){
    #ifdef STREAK
      if (vK >= 1.0) discard;
      gl_FragColor = vec4(mix(uC2, vec3(1.0), 0.35), 1.0 - vK * vK);
    #else
      // Estrella de 8 puntas con borde duro (toon): radio que oscila con el ángulo.
      vec2 q = vUv * 2.0 - 1.0;
      float a = atan(q.y, q.x);
      float r = length(q);
      float star = 0.52 + 0.3 * pow(abs(cos(a * 4.0)), 3.0);
      if (r > star || vK >= 1.0) discard;
      float core = step(r, star * 0.55);
      vec3 col = mix(uC1, vec3(1.0), core * 0.85);
      gl_FragColor = vec4(col, 1.0 - smoothstep(0.55, 1.0, vK));
    #endif
  }`;

export const ImpactBurst: React.FC = () => {
  const { star, streaks, mats } = useMemo(() => {
    const uniforms = () => ({ uAt: { value: impact.at }, uT: { value: 99 }, uSize: { value: 1 }, uC1: { value: impact.c1 }, uC2: { value: impact.c2 } });
    const mk = (streak: boolean) => new THREE.ShaderMaterial({
      uniforms: uniforms(), vertexShader: VERT, fragmentShader: FRAG, defines: streak ? { STREAK: '' } : {},
      transparent: true, depthTest: false, depthWrite: false,
    });
    const sMat = mk(false), kMat = mk(true);
    const starMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sMat);
    // Trazo: triángulo alargado; y=0 en la base (ancho), y=1 en la punta.
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
    const ang = new Float32Array(STREAKS), len = new Float32Array(STREAKS);
    for (let i = 0; i < STREAKS; i++) { ang[i] = (i / STREAKS) * Math.PI * 2 + ((i * 7) % 5) * 0.06; len[i] = 0.55 + ((i * 13) % 7) * 0.09; }
    g.setAttribute('aAng', new THREE.InstancedBufferAttribute(ang, 1));
    g.setAttribute('aLen', new THREE.InstancedBufferAttribute(len, 1));
    g.instanceCount = STREAKS;
    const streakMesh = new THREE.Mesh(g, kMat);
    for (const m of [starMesh, streakMesh]) { m.frustumCulled = false; m.renderOrder = 20; m.visible = false; }
    return { star: starMesh, streaks: streakMesh, mats: [sMat, kMat] };
  }, []);
  useEffect(() => () => { star.geometry.dispose(); streaks.geometry.dispose(); mats.forEach((m) => m.dispose()); }, [star, streaks, mats]);

  useFrame((_, dt) => {
    impact.t += Math.min(dt, 0.05);
    const on = impact.t < 0.4;
    star.visible = on; streaks.visible = on;
    if (!on) return;
    const sz = impact.size * (impact.crit ? 1.35 : 1);
    for (const m of mats) { m.uniforms.uT.value = impact.t; m.uniforms.uSize.value = sz; }
  });

  return (
    <>
      <primitive object={streaks} />
      <primitive object={star} />
    </>
  );
};
