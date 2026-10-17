// Engancha el input de cámara (arrastrar/rueda/pinza) al canvas real. Vive dentro del <Canvas> solo para
// poder leer `gl.domElement` vía useThree; no renderiza nada.
import React from 'react';
import { useThree } from '@react-three/fiber';
import { useCameraInput } from './useCameraInput';

export const CameraInput: React.FC = () => {
  const canvas = useThree((s) => s.gl.domElement);
  useCameraInput(canvas);
  return null;
};
