// Carga GLBs reales y aplana cada malla a geometría lista para InstancedMesh, convirtiendo el material
// a cel-shading por el camino (ver toon.ts) para que todos los packs compartan una sola luz.
//
// Dos formas de cargar:
//   loadModelParts(url)            — todas las mallas del archivo, como un solo prop (Kenney: 1 GLB = 1 prop)
//   loadNodeParts(url, 'Rock_3')   — un nodo con nombre dentro del archivo, recentrado en el origen
//
// La segunda existe por el pack Ultimate Stylized Nature de Quaternius: cada GLB trae 5 variantes como
// nodos hermanos colocados uno al lado del otro en el espacio del archivo. Instanciarlas juntas
// replicaría esa fila de 5; hay que sacarlas de a una y traerlas al origen.
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import type { GLTF } from 'three-stdlib';
import { toonFromMaterial } from './toon';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface ModelSet {
  parts: ModelPart[];
  /** Tamaño nativo del modelo en metros, para poder escalar a una altura objetivo real. */
  size: THREE.Vector3;
  /**
   * Y mínima de la geometría. Es 0 en todo lo que pasa por groundAndCenter, pero los GLB de un solo prop
   * se instancian tal como los exportó el artista y muchos tienen el origen en su centro, no en la base
   * (la tienda del campamento empieza en -0.75). Quien coloca necesita el dato para subir la instancia,
   * porque al escalar ese hueco también se multiplica y el prop se entierra.
   */
  base: number;
}

const loader = new GLTFLoader();
const gltfCache = new Map<string, Promise<GLTF>>();
const partsCache = new Map<string, Promise<ModelSet>>();

function loadGLTF(url: string): Promise<GLTF> {
  let entry = gltfCache.get(url);
  if (!entry) {
    entry = loader.loadAsync(url).then((gltf) => {
      gltf.scene.updateWorldMatrix(true, true);
      return gltf;
    });
    gltfCache.set(url, entry);
  }
  return entry;
}

/**
 * Hornea la matriz mundial de cada malla en su geometría, de modo que la geometría resultante ya está
 * en el espacio del archivo y se puede meter en un InstancedMesh con una transformación limpia. Esto
 * aplana cualquier offset/escala/rotación que el exportador de Blender haya dejado en nodos padre.
 */
function bakeMeshes(root: THREE.Object3D): ModelPart[] {
  const parts: ModelPart[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeVertexNormals();
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    parts.push({ geometry, material: toonFromMaterial(source) });
  });
  return parts;
}

/** Centra el conjunto en XZ y le deja la base en y=0, para poder plantarlo con placement.y = heightAt(). */
function groundAndCenter(parts: ModelPart[]): THREE.Vector3 {
  const box = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
  }
  if (box.isEmpty()) return new THREE.Vector3();

  const center = box.getCenter(new THREE.Vector3());
  const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
  for (const part of parts) {
    part.geometry.translate(offset.x, offset.y, offset.z);
    part.geometry.computeBoundingBox();
  }
  return box.getSize(new THREE.Vector3());
}

export function loadModelParts(url: string): Promise<ModelPart[]> {
  return loadModelSetOne(url).then((set) => set.parts);
}

export function loadModelSetOne(url: string): Promise<ModelSet> {
  const key = url;
  let entry = partsCache.get(key);
  if (!entry) {
    entry = loadGLTF(url).then((gltf) => {
      const parts = bakeMeshes(gltf.scene);
      const box = new THREE.Box3();
      for (const part of parts) {
        part.geometry.computeBoundingBox();
        if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
      }
      if (box.isEmpty()) return { parts, size: new THREE.Vector3(), base: 0 };
      return { parts, size: box.getSize(new THREE.Vector3()), base: box.min.y };
    });
    partsCache.set(key, entry);
  }
  return entry;
}

/** Saca un nodo con nombre de un GLB que contiene varias variantes, recentrado y apoyado en y=0. */
export function loadNodeParts(url: string, node: string): Promise<ModelSet> {
  const key = `${url}#${node}`;
  let entry = partsCache.get(key);
  if (!entry) {
    entry = loadGLTF(url).then((gltf) => {
      const target = gltf.scene.getObjectByName(node);
      if (!target) {
        const available = [] as string[];
        gltf.scene.traverse((o) => { if (o.name) available.push(o.name); });
        throw new Error(`loadNodeParts: no existe el nodo "${node}" en ${url}. Disponibles: ${available.join(', ')}`);
      }
      const parts = bakeMeshes(target);
      const size = groundAndCenter(parts);
      return { parts, size, base: 0 };
    });
    partsCache.set(key, entry);
  }
  return entry;
}

export function loadModelSet(urls: string[]): Promise<Map<string, ModelPart[]>> {
  return Promise.all(urls.map((u) => loadModelParts(u).then((parts) => [u, parts] as const))).then(
    (entries) => new Map(entries),
  );
}

/** Carga muchas variantes identificadas por "url#Nodo" y las devuelve indexadas por esa misma clave. */
export function loadVariantSet(keys: string[]): Promise<Map<string, ModelSet>> {
  return Promise.all(
    keys.map((key) => {
      const [url, node] = key.split('#');
      const promise = node ? loadNodeParts(url, node) : loadModelSetOne(url);
      return promise.then((set) => [key, set] as const);
    }),
  ).then((entries) => new Map(entries));
}
