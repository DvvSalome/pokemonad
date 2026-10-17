// Construye los InstancedMesh del mundo a partir de una lista plana de colocaciones, con contorno
// cel-shaded opcional. Todos los archivos de decoración pasaban por aquí copiando las mismas ~40
// líneas; esto lo centraliza y hace que el contorno sea una sola bandera.
//
// Agrupa por (variante, tinte): cada grupo es un InstancedMesh por malla del modelo. El tinte se
// resuelve como clon del material en vez de instanceColor a propósito — instanceColor solo llega al
// fragment shader si vertexColors está activo, y activarlo sin atributo `color` en la geometría deja
// las mallas en negro. Unos pocos clones de material cuestan menos que ese riesgo.
import * as THREE from 'three';
import type { ModelSet } from './modelLoader';
import { outlineMaterial, toonFromMaterial, OUTLINE_COLOR } from './toon';

/**
 * Tinte por rol de material. Los packs nombran sus materiales por parte (`PineTree_Bark`,
 * `PalmTree_Leaves`, `Bush_Leaves`), así que se puede poner otoño en las hojas o escarcha en la copa
 * sin manchar el tronco.
 */
export interface Tint {
  all?: THREE.Color;
  leaves?: THREE.Color;
  bark?: THREE.Color;
}

const LEAF_MATERIAL = /leaf|leaves|petal|flower|foliage/i;
const BARK_MATERIAL = /bark|trunk|stem|wood/i;

function tintFor(materialName: string, tint: Tint): THREE.Color | null {
  if (tint.leaves && LEAF_MATERIAL.test(materialName)) return tint.leaves;
  if (tint.bark && BARK_MATERIAL.test(materialName)) return tint.bark;
  return tint.all ?? null;
}

export interface Placement {
  /** Clave "url#Nodo" (o "url") que identifica la variante en el mapa de modelos. */
  key: string;
  x: number;
  y: number;
  z: number;
  /** Rotación en Y, radianes. */
  r: number;
  /** Escala uniforme. */
  s: number;
  /** Inclinación en radianes: rompe la verticalidad perfecta que delata la colocación procedural. */
  tilt?: number;
  /** Nombre del bucket de tinte; colocaciones con el mismo bucket comparten material. */
  tintKey?: string;
  /** Tinte multiplicado sobre el material base. Debe ser consistente para un mismo tintKey. */
  tint?: Tint;
}

export interface BuildOptions {
  /** Grosor del contorno en metros de mundo. 0 lo desactiva. */
  outline?: number;
  outlineColor?: THREE.ColorRepresentation;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * El contorno empuja vértices a lo largo de la normal en espacio de objeto, así que la matriz de
 * instancia multiplica ese grosor por su escala. Dividiendo por la escala media del grupo el contorno
 * se ve del mismo grosor en un árbol grande y en un arbusto pequeño.
 */
function outlineWidthFor(group: Placement[], outline: number): number {
  let sum = 0;
  for (const p of group) sum += p.s;
  const mean = sum / Math.max(1, group.length);
  return outline / Math.max(1e-4, mean);
}

export function buildInstanced(
  models: Map<string, ModelSet>,
  placements: Placement[],
  { outline = 0, outlineColor = OUTLINE_COLOR, castShadow = true, receiveShadow = false }: BuildOptions = {},
): THREE.Object3D[] {
  const groups = new Map<string, Placement[]>();
  for (const p of placements) {
    const gk = p.tintKey ? `${p.key}::${p.tintKey}` : p.key;
    const arr = groups.get(gk);
    if (arr) arr.push(p); else groups.set(gk, [p]);
  }

  const out: THREE.Object3D[] = [];
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];

  for (const group of groups.values()) {
    const set = models.get(group[0].key);
    if (!set) continue;
    const tint = group[0].tint;

    matrices.length = 0;
    for (const p of group) {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.tilt ? p.tilt : 0, p.r, p.tilt ? p.tilt * 0.6 : 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }

    for (const part of set.parts) {
      let material = part.material;
      if (tint) {
        const color = tintFor(part.material.name || '', tint);
        if (color) {
          // NO usar material.clone(): Material.copy de three no conserva onBeforeCompile ni
          // customProgramCacheKey, así que el clon pierde el shader toon (rim + oclusor) y su userData
          // queda como copia JSON muerta. El follaje tintado se veía plano y nunca se desvanecía bajo la
          // cámara. Reconstruir por la fábrica toon reaplica el shader y comparte los uniforms del oclusor.
          material = toonFromMaterial(part.material, { tint: color });
        }
      }
      const mesh = new THREE.InstancedMesh(part.geometry, material, group.length);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      out.push(mesh);

      const source = part.material as THREE.MeshToonMaterial;
      // El contorno por casco invertido solo funciona en geometría sólida y cerrada. El follaje de estos
      // packs son cartas planas (un plano con la silueta en el canal alfa), y desplazar un plano a lo
      // largo de su normal no lo engorda: deja la copia oscura flotando justo delante de la hoja, así que
      // la copa se llena de manchas con forma de hoja. El alphaTest marca justo esas partes, así que sirve
      // para distinguirlas: contorno en troncos y rocas, nunca en hojas.
      const isCutoutCard = source.alphaTest > 0;
      if (outline <= 0 || isCutoutCard) continue;
      const lineMaterial = outlineMaterial(outlineWidthFor(group, outline), outlineColor);
      const line = new THREE.InstancedMesh(part.geometry, lineMaterial, group.length);
      for (let i = 0; i < matrices.length; i++) line.setMatrixAt(i, matrices[i]);
      line.instanceMatrix.needsUpdate = true;
      line.castShadow = false;
      line.receiveShadow = false;
      // El shader desplaza vértices, así que la esfera de recorte real es mayor que la de la geometría.
      line.frustumCulled = false;
      out.push(line);
    }
  }
  return out;
}

/**
 * Escala para que un modelo quede de `targetHeight` metros, acotada.
 *
 * El tope importa: dentro de una misma especie el pack mezcla ejemplares adultos y plantones (PineTree_2
 * mide 6.9 m de nativo, PineTree_3 mide 2.35 m). Llevar los dos a la misma altura obligaría a inflar el
 * plantón casi 6×, y un modelo estirado así pierde la proporción tronco/copa y se lee como un bulto.
 * Con el tope el plantón se queda pequeño y cae solo en el sotobosque, que es donde el artista lo puso.
 * Por eso la altura declarada en stylized.ts es un objetivo, no una garantía.
 */
export function scaleForHeight(set: ModelSet, targetHeight: number, clamp: [number, number] = [0.75, 2.4]): number {
  if (set.size.y <= 1e-4) return 1;
  const raw = targetHeight / set.size.y;
  return Math.min(clamp[1], Math.max(clamp[0], raw));
}

/**
 * Escala para que la dimensión mayor del modelo mida `target` metros.
 *
 * Para los props sueltos esto funciona mejor que escalar por altura, porque muchos son planos o alargados
 * (un tronco caído, una hoja de nenúfar, un círculo de losas): su altura no dice nada de lo grande que se
 * ven, y pedirles una altura objetivo los infla de forma absurda. La dimensión mayor sí es lo que el ojo
 * mide. Aquí no hace falta tope: cada prop lleva su objetivo escrito a mano, no compartido con variantes.
 */
export function scaleForSize(set: ModelSet, target: number): number {
  const largest = Math.max(set.size.x, set.size.y, set.size.z);
  if (largest <= 1e-4) return 1;
  return target / largest;
}
