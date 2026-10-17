// Hook compartido por las capas de vegetación: carga las variantes que hagan falta y construye los
// InstancedMesh.
//
// Existe porque la escala no se puede calcular al sembrar. Las capas se declaran en metros ("este árbol
// mide 12 m"), pero convertir metros a escala necesita el tamaño nativo del GLB, y eso solo se conoce
// una vez cargado. Así que el sembrado produce semillas con una altura objetivo y este hook las cierra
// en colocaciones con escala real cuando los modelos llegan.
import { useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import { loadVariantSet, type ModelSet } from './modelLoader';
import { buildInstanced, scaleForHeight, type BuildOptions, type Placement } from './instancing';
import { applyWind, type WindKind } from './life/wind';

export interface Seed extends Omit<Placement, 's'> {
  /** Altura objetivo en metros. Es un objetivo: scaleForHeight la acota (ver su comentario). */
  height: number;
}

export interface StylizedOptions extends BuildOptions {
  /** Rango en el que se acota la escala resultante. */
  scaleClamp?: [number, number];
  /** Perfil de viento (ver life/wind.ts). Sin él la capa queda quieta: rocas, fauna. */
  wind?: WindKind;
}

export function useStylizedInstances(seeds: Seed[], options: StylizedOptions = {}): THREE.Object3D[] {
  const keys = useMemo(() => Array.from(new Set(seeds.map((s) => s.key))), [seeds]);
  const [models, setModels] = useState<Map<string, ModelSet> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadVariantSet(keys)
      .then((m) => { if (!cancelled) setModels(m); })
      .catch((err) => console.error('[stylized] fallo al cargar variantes', err));
    return () => { cancelled = true; };
  }, [keys]);

  return useMemo(() => {
    if (!models) return [];
    const placements: Placement[] = [];
    for (const seed of seeds) {
      const set = models.get(seed.key);
      if (!set) continue;
      placements.push({ ...seed, s: scaleForHeight(set, seed.height, options.scaleClamp) });
    }
    const built = buildInstanced(models, placements, options);
    if (options.wind) applyWind(built, options.wind);
    return built;
    // options se declara inline en cada capa, así que compararlo por referencia recrearía las mallas en
    // cada render. Las capas son estáticas, así que depender de models/seeds es lo correcto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, seeds]);
}
