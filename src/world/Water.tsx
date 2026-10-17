import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { LAKE, POND, WATER_Y, heightAt } from './terrain';
import { SKY, SUN, flatLight } from './lighting';
import { atmoUniforms } from './atmo/fog';

// Agua estilizada: color por profundidad real (se hornea heightAt en una textura pequeña al montar), espuma
// en la orilla que late hacia fuera, líneas de ondas tipo toon, destellos del sol y reflejo del cielo en
// rasante. Todo mate y en colores planos: nada de especular ancho, que es lo que hacía verse plástico.

const DEPTH_MIN = -0.5;
const DEPTH_RANGE = 4.5;

const waterVert = `
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += sin(wp.x * 0.45 + uTime * 1.1) * 0.035 + cos(wp.z * 0.38 + uTime * 0.8) * 0.03;
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const waterFrag = `
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform sampler2D uDepth;
  uniform vec4 uBounds;
  uniform float uDepthBoost;
  uniform vec3 uLight;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uGlow;
  uniform vec3 uMoonDir;
  uniform float uNight;
  varying vec3 vWorldPos;

  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 p = vWorldPos.xz;
    float t = uTime;
    vec2 duv = (p - uBounds.xy) / uBounds.zw;
    float depth = texture2D(uDepth, duv).r * ${DEPTH_RANGE.toFixed(1)} + ${DEPTH_MIN.toFixed(1)};
    depth *= uDepthBoost;

    // Profundidad en tres tonos suaves: turquesa de orilla, azul medio, azul hondo.
    vec3 shallow = vec3(0.36, 0.78, 0.76);
    vec3 mid = vec3(0.18, 0.55, 0.72);
    vec3 deep = vec3(0.10, 0.30, 0.55);
    float dj = depth + (vnoise(p * 0.35 + t * 0.05) - 0.5) * 0.25;
    vec3 col = mix(shallow, mid, smoothstep(0.15, 0.9, dj));
    col = mix(col, deep, smoothstep(1.2, 2.8, dj));

    // Reflejo del cielo solo en rasante: de cerca se ve el color del agua, a lo lejos el cielo.
    vec3 V = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - max(V.y, 0.0), 4.0);
    col *= uLight * (1.0 - 0.45 * uNight);
    // El reflejo no pasa por uLight: es el cielo, ya viene con su luz. Incluye el resplandor del sol, que es
    // lo que pinta de naranja el lago al atardecer.
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    vec3 refl = mix(uSkyHorizon, uSkyTop, 0.3) + uGlow * pow(max(dot(R, uSunDir), 0.0), 5.0);
    col = mix(col, refl, fres * 0.5);

    // Ondas: isolíneas finas de un ruido que deriva; se apagan a distancia para no hacer moiré.
    float n = vnoise(p * 0.22 + vec2(t * 0.05, t * 0.03)) + 0.5 * vnoise(p * 0.5 - vec2(t * 0.04, -t * 0.06));
    float band = abs(fract(n * 3.0) - 0.5);
    float camDist = length(cameraPosition - vWorldPos);
    float patchy = smoothstep(0.45, 0.7, vnoise(p * 0.07 + t * 0.01));
    float lines = smoothstep(0.025, 0.0, band - 0.006) * (1.0 - smoothstep(18.0, 45.0, camDist)) * patchy;
    col = mix(col, uLight * vec3(0.78, 0.93, 0.98), lines * 0.2 * smoothstep(0.5, 1.2, depth));

    // Espuma: franja pegada a la orilla más anillos que salen hacia fuera y se deshacen con ruido.
    float brk = vnoise(p * 1.6 + vec2(t * 0.15, -t * 0.1));
    float edge = 1.0 - smoothstep(0.02, 0.16 + brk * 0.1, depth);
    float ringPh = fract(depth * 2.4 - t * 0.28);
    float ring = smoothstep(0.1, 0.0, abs(ringPh - 0.5) - 0.34) * (1.0 - smoothstep(0.15, 0.6, depth));
    ring *= step(0.42, brk);
    float foam = clamp(edge + ring * 0.8, 0.0, 1.0);
    vec3 foamCol = uLight * vec3(0.93, 0.97, 1.0);
    col = mix(col, foamCol, foam * 0.85);

    // Destellos: puntos duros donde el reflejo del sol coincide con una cresta del ruido fino.
    vec2 g = vec2(vnoise(p * 2.2 + t * 0.6), vnoise(p * 2.2 - t * 0.5 + 7.0)) - 0.5;
    vec3 N = normalize(vec3(g.x * 0.5, 1.0, g.y * 0.5));
    // De noche los destellos siguen a la luna, más escasos y fríos.
    vec3 gDir = normalize(mix(uSunDir, uMoonDir, uNight));
    float spec = max(dot(reflect(-V, N), gDir), 0.0);
    float glint = step(0.985, spec) * step(mix(0.74, 0.8, uNight), vnoise(p * 6.0 + t * 1.3));
    float lit = max(smoothstep(0.0, 0.1, uSunDir.y) * (1.0 - uNight), uNight * smoothstep(0.0, 0.1, uMoonDir.y));
    vec3 gCol = mix(uSunColor * 1.1, vec3(0.75, 0.82, 1.0), uNight);
    col += gCol * glint * lit * (1.0 - foam);

    float alpha = mix(0.8, 0.95, smoothstep(0.2, 1.6, depth));
    alpha = max(alpha, foam * 0.95) * smoothstep(-0.12, 0.0, depth);

    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

type Body = { x0: number; z0: number; w: number; d: number; tex: THREE.DataTexture; boost: number };

function bakeDepth(x0: number, z0: number, w: number, d: number, res: number, boost = 1): Body {
  const nx = res, nz = Math.max(8, Math.round(res * d / w));
  const data = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) / nx * w, z = z0 + (j + 0.5) / nz * d;
      const depth = WATER_Y - heightAt(x, z);
      data[j * nx + i] = Math.round(THREE.MathUtils.clamp((depth - DEPTH_MIN) / DEPTH_RANGE, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { x0, z0, w, d, tex, boost };
}

export const Water: React.FC = () => {
  const shared = useMemo(() => ({
    uTime: { value: 0 },
    uLight: { value: new THREE.Color(1, 1, 1) },
    uSkyTop: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 },
  }), []);

  const [lake, pond] = useMemo(() => [
    bakeDepth(LAKE.x - LAKE.rx, LAKE.z - LAKE.rz, LAKE.rx * 2, LAKE.rz * 2, 128),
    bakeDepth(POND.x - POND.r - 0.5, POND.z - POND.r - 0.5, POND.r * 2 + 1, POND.r * 2 + 1, 48, 3),
  ], []);

  const makeMat = (b: Body) => new THREE.ShaderMaterial({
    vertexShader: waterVert, fragmentShader: waterFrag,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...atmoUniforms, ...shared,
      uDepth: { value: b.tex }, uBounds: { value: new THREE.Vector4(b.x0, b.z0, b.w, b.d) },
      // El estanque apenas mide 0.4 m: se exagera para que tenga centro azul y no quede todo turquesa.
      uDepthBoost: { value: b.boost },
    },
    transparent: true,
    fog: true,
    // depthWrite:false — el agua es transparente; con depthWrite en true (el default de ShaderMaterial)
    // el orden de dibujado transparente vs. lo que hay detrás se vuelve inestable al mover la cámara, y
    // la espuma casi blanca del borde parpadeaba. El estanque está a ~17 m del spawn, así que se veía casi
    // siempre. Sin escritura de profundidad, el agua no participa del z-fight y no parpadea.
    depthWrite: false,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [lakeMat, pondMat] = useMemo(() => [makeMat(lake), makeMat(pond)], [lake, pond]);

  useEffect(() => () => {
    lake.tex.dispose(); pond.tex.dispose(); lakeMat.dispose(); pondMat.dispose();
  }, [lake, pond, lakeMat, pondMat]);

  useFrame(({ clock }) => {
    shared.uTime.value = clock.elapsedTime;
    flatLight(shared.uLight.value);
    shared.uSkyTop.value.copy(SKY.top);
    shared.uSkyHorizon.value.copy(SKY.horizon);
    shared.uSunDir.value.copy(SKY.sunDir);
    shared.uSunColor.value.copy(SUN.color);
    shared.uGlow.value.copy(SKY.glow);
    shared.uMoonDir.value.copy(SKY.moonDir);
    shared.uNight.value = SKY.night;
  });

  return (
    <group>
      <mesh position={[LAKE.x, WATER_Y, LAKE.z]} rotation={[-Math.PI / 2, 0, 0]} material={lakeMat}>
        <planeGeometry args={[LAKE.rx * 2, LAKE.rz * 2, 24, 24]} />
      </mesh>
      <mesh position={[POND.x, WATER_Y, POND.z]} rotation={[-Math.PI / 2, 0, 0]} material={pondMat}>
        {/* Más grande que la orilla: el borde lo recorta la profundidad horneada, no el polígono. */}
        <circleGeometry args={[POND.r + 0.5, 40]} />
      </mesh>
    </group>
  );
};
