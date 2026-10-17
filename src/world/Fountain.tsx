import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { heightAt, PLAZA } from './terrain';
import { loadModelParts, type ModelPart } from './modelLoader';

const waterVert = `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    pos.y += sin(pos.x * 4.0 + uTime * 2.2) * 0.03 + cos(pos.z * 3.5 + uTime * 1.8) * 0.03;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;
const waterFrag = `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float ripple = sin(length(vUv - 0.5) * 30.0 - uTime * 3.0) * 0.5 + 0.5;
    vec3 col = mix(vec3(0.2, 0.5, 0.7), vec3(0.55, 0.8, 0.9), ripple * 0.4);
    gl_FragColor = vec4(col, 0.85);
  }
`;

interface Spot { x: number; z: number; y: number; scale: number }

/** Una fuente decorativa: base de piedra circular + estatua central + disco de agua animado. */
const FountainAt: React.FC<Spot> = ({ x, z, y, scale }) => {
  const uniforms = useRef({ uTime: { value: 0 } });
  const [parts, setParts] = useState<{ base: ModelPart[]; centerpiece: ModelPart[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadModelParts('/nature/path_stoneCircle.glb'),
      loadModelParts('/nature/statue_obelisk.glb'),
    ]).then(([base, centerpiece]) => { if (!cancelled) setParts({ base, centerpiece }); });
    return () => { cancelled = true; };
  }, []);

  const waterMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: waterVert, fragmentShader: waterFrag,
    uniforms: uniforms.current, transparent: true, side: THREE.DoubleSide,
  }), []);

  useFrame(({ clock }) => { uniforms.current.uTime.value = clock.elapsedTime; });

  if (!parts) return null;

  return (
    <group position={[x, y, z]} scale={scale}>
      {parts.base.map((p, i) => (
        <mesh key={`b${i}`} geometry={p.geometry} material={p.material} receiveShadow />
      ))}
      {parts.centerpiece.map((p, i) => (
        <mesh key={`c${i}`} geometry={p.geometry} material={p.material} castShadow position={[0, 0, 0]} />
      ))}
      <mesh position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat}>
        <circleGeometry args={[1.6, 24]} />
      </mesh>
    </group>
  );
};

export const Fountains: React.FC = () => {
  const spots = useMemo<Spot[]>(() => [
    { x: PLAZA.x, z: PLAZA.z, y: heightAt(PLAZA.x, PLAZA.z), scale: 2.4 },
    { x: -24, z: -22, y: heightAt(-24, -22), scale: 1.6 },
  ], []);

  return (
    <>
      {spots.map((s, i) => <FountainAt key={i} {...s} />)}
    </>
  );
};
