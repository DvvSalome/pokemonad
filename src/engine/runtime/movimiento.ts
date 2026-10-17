// Resolución de movimiento con deslizamiento sobre colisión (walk along the wall en vez de trabarse).
// Portado de cowork-v3 sin cambios de lógica — es puro, genérico, no depende de oficina.
export interface Posicion3DPlano { x: number; z: number }

export interface MovimientoIntento3D { dx: number; dz: number }

export interface MovimientoResuelto3D {
  posicion: Posicion3DPlano;
  seMovio: boolean;
  colisionX: boolean;
  colisionZ: boolean;
}

interface ResolverMovimiento3DParams {
  posicionActual: Posicion3DPlano;
  movimiento: MovimientoIntento3D;
  /** Radio del mundo caminable (en cowork-v3 era un cuadrado 0..worldSize; aquí es un círculo centrado en 0). */
  esPosicionValida: (x: number, z: number) => boolean;
}

export const resolverMovimientoConDeslizamiento = ({
  posicionActual,
  movimiento,
  esPosicionValida,
}: ResolverMovimiento3DParams): MovimientoResuelto3D => {
  const destinoCompleto = { x: posicionActual.x + movimiento.dx, z: posicionActual.z + movimiento.dz };

  if (esPosicionValida(destinoCompleto.x, destinoCompleto.z)) {
    return {
      posicion: destinoCompleto,
      seMovio: destinoCompleto.x !== posicionActual.x || destinoCompleto.z !== posicionActual.z,
      colisionX: false,
      colisionZ: false,
    };
  }

  const destinoSoloX = { x: posicionActual.x + movimiento.dx, z: posicionActual.z };
  if (movimiento.dx !== 0 && esPosicionValida(destinoSoloX.x, destinoSoloX.z)) {
    return { posicion: destinoSoloX, seMovio: destinoSoloX.x !== posicionActual.x, colisionX: false, colisionZ: movimiento.dz !== 0 };
  }

  const destinoSoloZ = { x: posicionActual.x, z: posicionActual.z + movimiento.dz };
  if (movimiento.dz !== 0 && esPosicionValida(destinoSoloZ.x, destinoSoloZ.z)) {
    return { posicion: destinoSoloZ, seMovio: destinoSoloZ.z !== posicionActual.z, colisionX: movimiento.dx !== 0, colisionZ: false };
  }

  return { posicion: posicionActual, seMovio: false, colisionX: movimiento.dx !== 0, colisionZ: movimiento.dz !== 0 };
};
