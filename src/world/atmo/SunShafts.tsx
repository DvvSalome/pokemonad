import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SKY, SUN } from '../lighting';

// Rayos de sol falsos para la hora dorada: un quad a pantalla completa, aditivo, con haces radiales que
// salen de la posición proyectada del sol. No hay oclusión real; por eso la intensidad es baja y se apaga
// en cuanto el sol queda detrás de la cámara. No es un pase de postproceso: se dibuja con la escena y es
// determinista por píxel, así que no puede reventar un frame a blanco como hacía el Bloom.

const vert = `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const frag = `
  uniform vec2 uSun;
  uniform float uAspect;
  uniform float uStrength;
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vNdc;
  void main() {
    vec2 d = (vNdc - uSun) * vec2(uAspect, 1.0);
    float r = length(d);
    float ang = atan(d.y, d.x);
    // Haces anchos y de bajo contraste, más marcados hacia abajo (la luz que cae sobre el valle).
    float a1 = 0.5 + 0.5 * sin(ang * 7.0 + sin(ang * 3.0 + uTime * 0.05) * 2.5);
    float a2 = 0.5 + 0.5 * sin(ang * 17.0 - uTime * 0.04 + 1.3);
    float rays = pow(a1 * (0.65 + 0.35 * a2), 1.6);
    float down = 0.55 + 0.45 * smoothstep(0.2, -0.8, d.y / max(r, 1e-3));
    float fall = exp(-r * 0.9) * smoothstep(0.0, 0.12, r);
    float core = exp(-r * 2.4);
    float a = uStrength * (rays * fall * down * 0.5 + core * 0.45);
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();

export const SunShafts: React.FC = () => {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const uniforms = useMemo(() => ({
    uSun: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    uStrength: { value: 0 },
    uColor: { value: new THREE.Color() },
    uTime: { value: 0 },
  }), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }), [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    camera.getWorldDirection(fwd);
    const facing = THREE.MathUtils.smoothstep(fwd.dot(SKY.sunDir), 0.2, 0.75);
    tmp.copy(camera.position).addScaledVector(SKY.sunDir, 300).project(camera);
    uniforms.uSun.value.set(tmp.x, tmp.y);
    uniforms.uAspect.value = size.width / Math.max(1, size.height);
    uniforms.uTime.value = clock.elapsedTime;
    const up = THREE.MathUtils.smoothstep(SKY.sunDir.y, -0.03, 0.04);
    uniforms.uStrength.value = (0.03 + 0.2 * SKY.golden) * facing * up * (1 - SKY.night);
    uniforms.uColor.value.copy(SUN.color).lerp(SKY.glow, 0.35);
  });

  return (
    <mesh frustumCulled={false} renderOrder={999} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};
