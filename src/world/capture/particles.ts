// Pool de partículas de la captura: un único THREE.Points por pool, con formas procedurales en el
// fragment shader (brillo, destello de 4 puntas, estrella toon, confeti, polvo). Todo vive en Float32Array
// preasignados: emitir y simular no reserva memoria en ningún frame.
import * as THREE from 'three';

export const Shape = { Glow: 0, Sparkle: 1, Star: 2, Confetti: 3, Puff: 4 } as const;
/** Comportamiento: balístico (gravedad + rozamiento), atraído hacia `attractor` en espiral, u orbitando `attractor`. */
export const Mode = { Free: 0, Seek: 1, Orbit: 2 } as const;
type ShapeId = (typeof Shape)[keyof typeof Shape];
type ModeId = (typeof Mode)[keyof typeof Mode];

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
attribute float aRot;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vRot;
void main() {
  vColor = aColor; vAlpha = aAlpha; vShape = aShape; vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(0.05, -mv.z) : 0.0;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vRot;
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c, -s, s, c) * p;
  float d = length(p);
  vec3 col = vColor;
  float a;
  if (vShape < 0.5) {
    a = pow(max(0.0, 1.0 - d), 2.2);
    col = mix(vColor, vec3(1.0), smoothstep(0.45, 0.0, d) * 0.75);
  } else if (vShape < 1.5) {
    vec2 q = abs(p);
    float rays = max(0.0, 1.0 - q.x * 9.0 - q.y * 0.95) + max(0.0, 1.0 - q.y * 9.0 - q.x * 0.95);
    a = clamp(rays + pow(max(0.0, 1.0 - d * 2.6), 2.0), 0.0, 1.0);
    col = mix(vColor, vec3(1.0), smoothstep(0.5, 0.0, d));
  } else if (vShape < 2.5) {
    float sd = sdStar5(p, 0.92, 0.45);
    a = smoothstep(0.04, -0.02, sd);
    // Estrella toon: relleno plano, corazón más claro y un borde un tono más oscuro.
    col = mix(vColor * 0.62, vColor, smoothstep(-0.02, -0.1, sd));
    col = mix(col, mix(vColor, vec3(1.0), 0.65), smoothstep(-0.26, -0.42, sd));
  } else if (vShape < 3.5) {
    vec2 q = abs(p);
    a = step(q.x, 0.85) * step(q.y, 0.42);
    col = vColor * (0.72 + 0.28 * abs(cos(vRot * 2.3)));
  } else {
    a = smoothstep(1.0, 0.78, d) * 0.55;
    col = mix(vColor, vColor * 0.8, smoothstep(0.2, 0.9, d));
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const _db = new THREE.Vector2();
const _c = new THREE.Color();

export class Particles {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  /** Punto de atracción (Mode.Seek) y centro de órbita (Mode.Orbit). */
  readonly attractor = new THREE.Vector3();
  private n: number;
  private next = 0;
  private alive = 0;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private shape: Float32Array; private rot: Float32Array;
  private vel: Float32Array; private life: Float32Array; private max: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private rotV: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private mode: Uint8Array;
  private geo: THREE.BufferGeometry;

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.shape = new Float32Array(n); this.rot = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.rotV = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.mode = new Uint8Array(n);
    const g = new THREE.BufferGeometry();
    const dyn = (a: Float32Array, k: number) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.pos, 3));
    g.setAttribute('aColor', dyn(this.col, 3));
    g.setAttribute('aSize', dyn(this.size, 1));
    g.setAttribute('aAlpha', dyn(this.alpha, 1));
    g.setAttribute('aShape', dyn(this.shape, 1));
    g.setAttribute('aRot', dyn(this.rot, 1));
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 11;
  }

  /**
   * Emite una partícula. `size` es el diámetro en metros al nacer y `sizeEnd` al morir; con Mode.Orbit,
   * (vx, vy, vz) = (radio, velocidad angular, altura sobre el centro) y `drag` = ángulo inicial.
   */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, sizeEnd: number,
    color: THREE.Color, shape: ShapeId, grav = 0, drag = 0, mode: ModeId = Mode.Free, spin = 0) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.life[i] = 0; this.max[i] = life; this.s0[i] = size; this.s1[i] = sizeEnd;
    this.shape[i] = shape; this.rot[i] = Math.random() * Math.PI * 2; this.rotV[i] = spin;
    this.grav[i] = grav; this.drag[i] = drag; this.mode[i] = mode;
    this.size[i] = size; this.alpha[i] = 0.0001;
    this.alive = 1;
  }

  /** Tamaño en píxeles de un metro a un metro de distancia (para gl_PointSize). */
  setScale(gl: THREE.WebGLRenderer, camera: THREE.Camera) {
    gl.getDrawingBufferSize(_db);
    this.material.uniforms.uScale.value = _db.y * 0.5 * camera.projectionMatrix.elements[5];
  }

  update(dt: number, time: number) {
    if (!this.alive) return;
    let alive = 0;
    const A = this.attractor;
    for (let i = 0; i < this.n; i++) {
      if (this.alpha[i] <= 0) continue;
      const i3 = i * 3;
      const l = (this.life[i] += dt);
      const k = l / this.max[i];
      if (k >= 1) { this.alpha[i] = 0; continue; }
      alive++;
      const m = this.mode[i];
      if (m === Mode.Orbit) {
        const r = this.vel[i3] * Math.min(1, k * 6);
        const a0 = this.vel[i3 + 1] * l + this.drag[i];
        this.pos[i3] = A.x + Math.cos(a0) * r;
        this.pos[i3 + 1] = A.y + this.vel[i3 + 2] + Math.sin(a0 * 2 + time) * 0.03;
        this.pos[i3 + 2] = A.z + Math.sin(a0) * r;
      } else {
        if (m === Mode.Seek) {
          // Atraído hacia el punto con fuerza creciente y un giro tangencial (la espiral hacia la bola).
          const dx = A.x - this.pos[i3], dy = A.y - this.pos[i3 + 1], dz = A.z - this.pos[i3 + 2];
          const dist = Math.hypot(dx, dy, dz) + 1e-4;
          if (dist < 0.06) { this.alpha[i] = 0; continue; }
          const pull = (10 + 26 * k) / dist;
          this.vel[i3] += (dx * pull - dz * 5 / dist) * dt;
          this.vel[i3 + 1] += dy * pull * dt;
          this.vel[i3 + 2] += (dz * pull + dx * 5 / dist) * dt;
          const damp = Math.exp(-dt * 4.5);
          this.vel[i3] *= damp; this.vel[i3 + 1] *= damp; this.vel[i3 + 2] *= damp;
        } else {
          this.vel[i3 + 1] -= this.grav[i] * dt;
          if (this.drag[i] > 0) {
            const damp = Math.exp(-dt * this.drag[i]);
            this.vel[i3] *= damp; this.vel[i3 + 1] *= damp; this.vel[i3 + 2] *= damp;
          }
        }
        this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      }
      this.rot[i] += this.rotV[i] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.alpha[i] = Math.max(0.0001, Math.min(1, k / 0.08) * Math.min(1, (1 - k) / 0.4));
    }
    this.alive = alive;
    const at = this.geo.attributes;
    at.position.needsUpdate = true; at.aColor.needsUpdate = true; at.aSize.needsUpdate = true;
    at.aAlpha.needsUpdate = true; at.aShape.needsUpdate = true; at.aRot.needsUpdate = true;
  }

  clear() { this.alpha.fill(0); this.alive = 0; this.geo.attributes.aAlpha.needsUpdate = true; }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}

/** Color al azar de una paleta, en un Color reutilizado (no lo guardes: se sobrescribe en la siguiente llamada). */
export function pick(list: THREE.Color[]): THREE.Color {
  return _c.copy(list[(Math.random() * list.length) | 0]);
}
