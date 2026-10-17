// Marcador simple para otro entrenador cuya posición aún no cargó su modelo real. Portado sin cambios.
import React from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

interface GhostAvatarProps {
  position?: THREE.Vector3 | [number, number, number];
  escala?: number;
  opacidad?: number;
  mostrarEtiqueta?: boolean;
  etiqueta?: string;
}

export const GhostAvatar: React.FC<GhostAvatarProps> = ({
  position = [0, 0, 0],
  escala = 1,
  opacidad = 0.35,
  mostrarEtiqueta = true,
  etiqueta = 'Hay alguien aquí',
}) => (
  <group position={position} scale={escala}>
    <mesh position={[0, 1.1, 0]} castShadow>
      <sphereGeometry args={[0.45, 18, 18]} />
      <meshStandardMaterial color="#94a3b8" transparent opacity={opacidad} />
    </mesh>
    <mesh position={[0, 0.45, 0]} castShadow>
      <cylinderGeometry args={[0.35, 0.5, 0.9, 16]} />
      <meshStandardMaterial color="#94a3b8" transparent opacity={opacidad} />
    </mesh>
    <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.7, 20]} />
      <meshStandardMaterial color="#94a3b8" transparent opacity={opacidad * 0.45} />
    </mesh>
    {mostrarEtiqueta && (
      <Text position={[0, 1.7, 0]} fontSize={0.18} color="#e2e8f0" anchorX="center" anchorY="middle">
        {etiqueta}
      </Text>
    )}
  </group>
);

export default GhostAvatar;
