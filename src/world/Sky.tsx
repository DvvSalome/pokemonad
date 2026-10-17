import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SKY, SUN } from './lighting';
import { atmoUniforms } from './atmo/fog';
import { SunShafts } from './atmo/SunShafts';

// Cúpula de cielo enganchada al ciclo día/noche (ver lighting.ts): degradado cenit → horizonte, sol con
// halo, nubes estilizadas que derivan, y de noche estrellas y luna. Todo en un único shader y un único
// draw call; las nubes son ruido proyectado sobre un plano alto, no geometría.
//
// Este componente también mantiene la niebla y el fondo del canvas igualados al horizonte, para que la
// lejanía se disuelva en el cielo en vez de cortarse contra él. El resplandor hacia el sol se suma igual
// aquí que en la niebla (pow 6 del mismo glow), así el terreno lejano y el cielo no dejan costura.

const skyVert = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFrag = `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uGlow;
  uniform vec3 uMoonDir;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uNight;
  uniform float uGolden;
  uniform float uTime;
  varying vec3 vDir;

  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float hp = max(h, 0.0);

    vec3 col = h > 0.0
      ? mix(uHorizon, uTop, pow(hp, 0.5))
      : mix(uHorizon, uGround, pow(-h, 0.4));

    // Resplandor: el mismo término que la niebla (fog.ts) pegado al horizonte, más un halo alto y amplio.
    float sd = dot(dir, uSunDir);
    float sdp = max(sd, 0.0);
    float nearHor = 1.0 - smoothstep(0.0, 0.55, hp);
    col += uGlow * pow(sdp, 6.0) * mix(0.35, 1.0, nearHor);
    col += uGlow * pow(sdp, 2.0) * 0.18 * nearHor;

    // Estrellas: una por celda de una rejilla 3D sobre la esfera, con parpadeo lento.
    float stars = 0.0;
    if (uNight > 0.01 && h > 0.0) {
      vec3 sp = dir * 150.0;
      vec3 cell = floor(sp);
      float r = hash3(cell);
      if (r > 0.96) {
        vec3 jit = vec3(hash3(cell + 3.1), hash3(cell + 7.7), hash3(cell + 1.3)) * 0.5 + 0.25;
        float d = length(fract(sp) - jit);
        float tw = 0.65 + 0.35 * sin(uTime * (1.2 + r * 3.0) + r * 80.0);
        stars = smoothstep(0.26, 0.0, d) * tw * (r > 0.99 ? 2.2 : 1.1);
      }
      stars *= uNight * smoothstep(0.02, 0.2, h);
    }
    col += vec3(0.9, 0.93, 1.0) * stars;

    // Luna: disco con sombreado de fase y manchas, y un halo frío.
    float md = dot(dir, uMoonDir);
    float moonDisk = smoothstep(0.99935, 0.99955, md);
    if (moonDisk > 0.0) {
      vec3 mU = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mV = cross(mU, uMoonDir);
      vec2 mp = vec2(dot(dir, mU), dot(dir, mV)) / 0.03;
      float spots = fbm(mp * 3.0 + 4.0);
      float phase = smoothstep(-0.6, 0.3, dot(mp, vec2(-0.8, 0.5)));
      vec3 moonCol = vec3(0.93, 0.95, 1.0) * mix(0.72, 1.0, smoothstep(0.35, 0.65, spots)) * mix(0.35, 1.0, phase);
      col = mix(col, moonCol, moonDisk * uNight);
    }
    col += vec3(0.55, 0.65, 0.95) * pow(max(md, 0.0), 90.0) * 0.28 * uNight;
    col += vec3(0.35, 0.45, 0.8) * pow(max(md, 0.0), 12.0) * 0.08 * uNight;

    // Sol: halo suave + disco de borde blando, tapado bajo el horizonte.
    float sunUp = smoothstep(-0.04, 0.02, uSunDir.y) * smoothstep(-0.01, 0.02, h);
    col += uSunColor * pow(sdp, 28.0) * 0.32 * sunUp;
    col += uSunColor * pow(sdp, 350.0) * 0.5 * sunUp;
    float disk = smoothstep(0.99905, 0.99935, sd) * sunUp;
    col = mix(col, uSunColor * 1.25 + vec3(0.1), disk * (1.0 - uNight));

    // Nubes: ruido proyectado sobre un plano alto (se aplanan hacia el horizonte como las de verdad). La
    // iluminación es la diferencia entre la densidad aquí y un paso hacia el sol: borde soleado claro,
    // panza en sombra — dos tonos suaves, estilo acuarela más que volumen.
    if (h > 0.0) {
      vec2 cuv = dir.xz / (h + 0.12) * 1.5;
      vec2 wind = vec2(uTime * 0.012, uTime * 0.005);
      // Máscara de baja frecuencia: agrupa las nubes en bancos y deja claros de cielo entre medias.
      float n = fbm(cuv + wind) + (vnoise(cuv * 0.22 + wind * 0.3) - 0.5) * 0.35;
      float cover = smoothstep(0.55, 0.66, n);
      if (cover > 0.001) {
        vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.09;
        float nS = fbm(cuv + wind + toSun);
        float lit = smoothstep(-0.03, 0.05, n - nS);
        vec3 cc = mix(uCloudShade, uCloudLit, 0.35 + 0.65 * lit);
        // Ribete luminoso en el borde de las nubes cercanas al sol.
        float rim = (1.0 - smoothstep(0.55, 0.64, n)) * pow(sdp, 10.0) * (1.0 - uNight);
        cc += uSunColor * rim * 0.9;
        float fade = smoothstep(0.0, 0.18, h);
        col = mix(col, cc, cover * fade * mix(0.92, 0.55, uNight));
      }
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

const WHITE = new THREE.Color('#fffaf2');
const WARM = new THREE.Color('#ffc4a0');
const NIGHT_LIT = new THREE.Color('#44528a');
const NIGHT_SHADE = new THREE.Color('#1e2854');
const DUSK_SHADE = new THREE.Color('#8a74a8');

export const Sky: React.FC = () => {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);

  const uniforms = useMemo(() => ({
    uTop: { value: new THREE.Color().copy(SKY.top) },
    uHorizon: { value: new THREE.Color().copy(SKY.horizon) },
    uGround: { value: new THREE.Color(0x5a9458) },
    uSunDir: { value: SKY.sunDir.clone() },
    uSunColor: { value: new THREE.Color().copy(SUN.color) },
    uGlow: { value: new THREE.Color().copy(SKY.glow) },
    uMoonDir: { value: SKY.moonDir.clone() },
    uCloudLit: { value: new THREE.Color('#ffffff') },
    uCloudShade: { value: new THREE.Color('#aec6d8') },
    uNight: { value: 0 },
    uGolden: { value: 0 },
    uTime: { value: 0 },
  }), []);
  // Material construido a mano: con <shaderMaterial uniforms> R3F acaba con sus propios envoltorios de
  // uniform y los escalares (uNight, uTime) escritos aquí no llegaban nunca a la GPU.
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVert, fragmentShader: skyFrag, uniforms,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }), [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  const fog = useRef<THREE.Fog | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);

  useFrame(({ clock }) => {
    const u = uniforms;
    u.uTop.value.copy(SKY.top);
    u.uHorizon.value.copy(SKY.horizon);
    // Disco del sol más claro que la luz direccional: la luz se tiñe, el disco no debe verse sucio.
    u.uSunColor.value.copy(SUN.color).lerp(WHITE, 0.35);
    u.uGlow.value.copy(SKY.glow);
    u.uSunDir.value.copy(SKY.sunDir);
    u.uMoonDir.value.copy(SKY.moonDir);
    u.uNight.value = SKY.night;
    u.uGolden.value = SKY.golden;
    u.uTime.value = clock.elapsedTime;
    // El suelo de la cúpula se mantiene por debajo del horizonte para que el borde del terreno no recorte
    // contra un color más claro que él.
    u.uGround.value.copy(SKY.horizon).multiplyScalar(0.55);

    const lit = u.uCloudLit.value.copy(WHITE).lerp(WARM, SKY.golden * 0.85).lerp(NIGHT_LIT, SKY.night);
    lit.lerp(SKY.horizon, 0.12);
    u.uCloudShade.value.copy(SKY.top).lerp(SKY.horizon, 0.7).lerp(WHITE, 0.25 * (1 - SKY.night))
      .lerp(DUSK_SHADE, SKY.golden * 0.55).lerp(NIGHT_SHADE, SKY.night * 0.8);

    const a = atmoUniforms;
    a.atmoSunDir.value.x = SKY.sunDir.x; a.atmoSunDir.value.y = SKY.sunDir.y; a.atmoSunDir.value.z = SKY.sunDir.z;
    a.atmoTop.value.x = SKY.top.r; a.atmoTop.value.y = SKY.top.g; a.atmoTop.value.z = SKY.top.b;
    a.atmoGlow.value.x = SKY.glow.r; a.atmoGlow.value.y = SKY.glow.g; a.atmoGlow.value.z = SKY.glow.b;
    // Bruma baja más densa al alba/ocaso y de noche, fina a mediodía.
    a.atmoHaze.value.z = 0.1 + 0.14 * Math.max(SKY.golden, SKY.night);

    // La cúpula sigue a la cámara: así la cámara siempre está en su centro y ningún punto del cielo cae
    // más allá del plano lejano. Antes la cúpula estaba fija en el origen; al alejarse el jugador hacia el
    // borde de la región, la cara lejana de la esfera (radio 420 + offset ~165) pasaba de far=560 y se
    // recortaba, dejando ver el color de fondo casi blanco del horizonte — y como el recorte cambiaba con
    // cada paso, parpadeaba. Centrada en la cámara, el cielo nunca se recorta.
    if (meshRef.current) meshRef.current.position.copy(camera.position);

    if (!fog.current && scene.fog instanceof THREE.Fog) fog.current = scene.fog;
    if (fog.current) {
      fog.current.color.copy(SKY.fog);
      fog.current.near = 100;
      fog.current.far = 360;
    }
    gl.setClearColor(SKY.fog);
  });

  return (
    <>
      <mesh ref={meshRef} scale={[420, 420, 420]} frustumCulled={false} renderOrder={-10} material={material}>
        <sphereGeometry args={[1, 48, 24]} />
      </mesh>
      <SunShafts />
    </>
  );
};
