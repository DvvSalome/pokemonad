import React, { useMemo } from 'react';
import * as THREE from 'three';
import { heightAt, coneY, naturalGroundColor } from './terrain';
import { toonMaterial } from './toon';

interface GroundProps {
  /** Tamaño del lado de la malla, en metros. La región caminable real es un círculo de radio ~156. */
  size?: number;
  /** Segmentos por lado. Más = más detalle de altura/color, más costo de construcción única. */
  segments?: number;
}

/**
 * El suelo de la región: una malla con desplazamiento de vértice (heightAt + el volcán) y color de
 * vértice (groundColor) por punto. Es la misma matemática que decide qué es caminable — el suelo que
 * ves y el suelo por el que puedes caminar nunca se desincronizan porque son la misma función.
 */
export const Ground: React.FC<GroundProps> = ({ size = 400, segments = 220 }) => {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    const hash2 = (x: number, z: number) => {
      const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heightAt(x, z) + coneY(x, z);
      pos.setY(i, h);
      naturalGroundColor(x, z, h, c);
      // Un moteado muy leve en dos escalas quita el aspecto de plástico liso. Antes iba al triple de
      // fuerza, que en un mundo cel-shaded lee como ruido sucio: el estilo pide superficies limpias y
      // que la variación la ponga la banda de luz, no el grano.
      const fine = hash2(x * 3.1, z * 3.1);
      const coarse = hash2(x * 0.35, z * 0.35);
      const speck = 0.955 + fine * 0.06 + coarse * 0.035;
      colors[i * 3] = c.r * speck;
      colors[i * 3 + 1] = c.g * speck;
      colors[i * 3 + 2] = c.b * speck;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [size, segments]);

  // El suelo también va cel-shaded: con MeshStandardMaterial la pendiente degradaba suave y el terreno
  // era la única superficie del mundo que no sombreaba en bandas, lo que delataba el truco. El rim va muy
  // bajo porque en una superficie tan extensa una luz de borde fuerte se convierte en un halo por toda la
  // silueta de las colinas.
  // occlude:false — el suelo NUNCA participa del fade de oclusor. Está justo bajo el jugador, dentro del
  // cono cámara→jugador, así que si participara se le abrían agujeros que dejaban ver el cielo con cada
  // paso (el parpadeo blanco). Excluirlo por completo, no por umbral de altura, es a prueba de fallos.
  const material = useMemo(() => toonMaterial(0xffffff, { vertexColors: true, rim: 0.05, occlude: false }), []);

  return <mesh geometry={geometry} material={material} receiveShadow />;
};
