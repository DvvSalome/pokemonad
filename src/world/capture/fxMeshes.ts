// Mallas de efecto de la captura: el rayo de energía bola→monstruo y los destellos/ondas de choque
// (quads con shader, en billboard o tumbados en el suelo). Aditivos y sin escribir profundidad.
import * as THREE from 'three';

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFace = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
uniform float uReach;
varying vec2 vUv;
varying float vFace;
void main() {
  // v = 0 en la bola, 1 en el monstruo; el frente del rayo avanza con uReach.
  if (vUv.y > uReach) discard;
  float bands = 0.5 + 0.5 * sin(vUv.y * 22.0 + uTime * 26.0);
  float swirl = 0.5 + 0.5 * sin(vUv.x * 18.85 - vUv.y * 9.0 + uTime * 12.0);
  float body = smoothstep(0.05, 0.6, vFace);
  float tip = smoothstep(uReach, uReach - 0.08, vUv.y);
  float a = uAlpha * body * tip * (0.35 + 0.45 * bands + 0.3 * swirl);
  vec3 col = mix(uColor, vec3(1.0), smoothstep(0.55, 1.0, vFace) * 0.8);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class Beam {
  readonly group = new THREE.Group();
  private outer: THREE.Mesh; private inner: THREE.Mesh;
  private mo: THREE.ShaderMaterial; private mi: THREE.ShaderMaterial;
  private geo: THREE.CylinderGeometry;
  constructor() {
    // Cono abierto: estrecho en la bola (y = 0) y ancho en el monstruo (y = 1).
    this.geo = new THREE.CylinderGeometry(1, 0.22, 1, 20, 1, true);
    this.geo.translate(0, 0.5, 0);
    const mat = (c: number) => new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      uniforms: { uColor: { value: new THREE.Color(c) }, uTime: { value: 0 }, uAlpha: { value: 0 }, uReach: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mo = mat(0xcfe9ff); this.mi = mat(0xffffff);
    this.outer = new THREE.Mesh(this.geo, this.mo);
    this.inner = new THREE.Mesh(this.geo, this.mi);
    this.inner.scale.set(0.38, 1, 0.38);
    this.outer.renderOrder = this.inner.renderOrder = 13;
    this.outer.frustumCulled = this.inner.frustumCulled = false;
    this.group.add(this.outer, this.inner);
    this.group.visible = false;
  }
  /** Tiende el rayo de `from` a `to` con anchura `w` (m) en el extremo del monstruo. */
  set(from: THREE.Vector3, to: THREE.Vector3, w: number, alpha: number, reach: number, time: number, color: THREE.Color) {
    const g = this.group;
    g.visible = alpha > 0.002;
    if (!g.visible) return;
    g.position.copy(from);
    _d.subVectors(to, from);
    const len = Math.max(0.01, _d.length());
    g.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
    g.scale.set(w, len, w);
    const o = this.mo.uniforms, i = this.mi.uniforms;
    o.uTime.value = i.uTime.value = time;
    o.uAlpha.value = i.uAlpha.value = alpha;
    o.uReach.value = i.uReach.value = reach;
    o.uColor.value.copy(color);
  }
  hide() { this.group.visible = false; }
  dispose() { this.geo.dispose(); this.mo.dispose(); this.mi.dispose(); }
}
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uAlpha;
uniform float uRing;
varying vec2 vUv;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a;
  vec3 col = uColor;
  if (uRing > 0.5) {
    // Onda de choque: aro que se abre y adelgaza.
    float r = 0.25 + 0.7 * uK, w = mix(0.16, 0.025, uK);
    a = smoothstep(w, 0.0, abs(d - r));
    col = mix(uColor, vec3(1.0), smoothstep(w * 0.6, 0.0, abs(d - r)) * 0.5);
  } else {
    // Destello: disco con núcleo blanco.
    a = pow(max(0.0, 1.0 - d), 1.6);
    col = mix(uColor, vec3(1.0), smoothstep(0.6, 0.0, d));
  }
  a *= uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;
const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

interface Slot { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; life: number; max: number; s0: number; s1: number; ground: boolean; peak: number }

/** Destellos y aros de choque (pocos a la vez: un pool fijo de quads). */
export class Flashes {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private next = 0;
  private geo = new THREE.PlaneGeometry(1, 1);
  constructor(n = 6) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: RING_VERT, fragmentShader: RING_FRAG,
        uniforms: { uColor: { value: new THREE.Color() }, uK: { value: 0 }, uAlpha: { value: 0 }, uRing: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 14;
      this.group.add(mesh);
      this.slots.push({ mesh, mat, life: 0, max: 0, s0: 0, s1: 0, ground: false, peak: 1 });
    }
  }
  /** `ring` = onda de choque (si no, destello); `ground` = tumbado en el suelo (si no, mira a cámara). */
  fire(at: THREE.Vector3, color: THREE.Color, size0: number, size1: number, dur: number, ring: boolean, ground = false, peak = 1) {
    const s = this.slots[this.next]; this.next = (this.next + 1) % this.slots.length;
    s.mesh.position.copy(at); s.mat.uniforms.uColor.value.copy(color); s.mat.uniforms.uRing.value = ring ? 1 : 0;
    s.life = 0.0001; s.max = dur; s.s0 = size0; s.s1 = size1; s.ground = ground; s.peak = peak;
    s.mesh.visible = true;
  }
  update(dt: number, camera: THREE.Camera) {
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.life += dt;
      const k = s.life / s.max;
      if (k >= 1) { s.life = 0; s.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k);
      s.mesh.scale.setScalar(s.s0 + (s.s1 - s.s0) * e);
      if (s.ground) s.mesh.rotation.set(-Math.PI / 2, 0, 0); else s.mesh.quaternion.copy(camera.quaternion);
      s.mat.uniforms.uK.value = e;
      s.mat.uniforms.uAlpha.value = s.peak * (1 - k) * Math.min(1, k / 0.06);
    }
  }
  clear() { for (const s of this.slots) { s.life = 0; s.mesh.visible = false; } }
  dispose() { this.geo.dispose(); this.slots.forEach((s) => s.mat.dispose()); }
}
