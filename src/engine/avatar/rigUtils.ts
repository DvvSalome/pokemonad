// Remapeo de huesos entre esqueletos distintos (Mixamo, retargets propios, etc). Portado sin cambios.
import * as THREE from 'three';
import { BONE_ALIASES } from './shared';

const UMBRAL_WARNING_REMAPPING = 0.75;

export function normalizeBoneName(name: string): string {
  let n = name;
  n = n.replace(/^Armature[|/]/, '');
  n = n.replace(/^mixamorig\d*[:]?/, '');
  n = n.replace(/^(Character_|Root_)/, '');
  n = n.replace(/(\D)0+(\d+)$/, '$1$2');
  return n;
}

export function remapAnimationTracks(
  clip: THREE.AnimationClip,
  boneNames: Set<string>,
  stripRootMotion = false,
  spineOverrides?: Map<string, string>,
  stripPositions = false,
  stripScale = false,
): THREE.AnimationClip {
  const remapped = clip.clone();
  const normalizedBoneMap = new Map<string, string>();

  for (const boneName of boneNames) {
    normalizedBoneMap.set(normalizeBoneName(boneName).toLowerCase(), boneName);
  }

  if (spineOverrides) {
    for (const [normalizedKey, actualBone] of spineOverrides) {
      normalizedBoneMap.set(normalizedKey, actualBone);
    }
  }

  const aliasToModelBone = new Map<string, string>();
  for (const boneName of boneNames) {
    const normalizedLower = normalizeBoneName(boneName).toLowerCase();
    for (const [, aliases] of Object.entries(BONE_ALIASES)) {
      if (aliases.includes(normalizedLower)) {
        for (const alias of aliases) {
          if (!aliasToModelBone.has(alias)) {
            aliasToModelBone.set(alias, boneName);
          }
        }
        break;
      }
    }
  }

  remapped.tracks = remapped.tracks
    .map((track) => {
      const dotIdx = track.name.indexOf('.');
      if (dotIdx === -1) return track;

      const boneName = track.name.substring(0, dotIdx);
      const property = track.name.substring(dotIdx);

      if (boneNames.has(boneName)) return track;

      const normalized = normalizeBoneName(boneName).toLowerCase();
      const matchedBone = normalizedBoneMap.get(normalized);
      if (matchedBone) {
        track.name = matchedBone + property;
        return track;
      }

      const aliasMatch = aliasToModelBone.get(normalized);
      if (aliasMatch) {
        track.name = aliasMatch + property;
        return track;
      }

      return track;
    })
    .filter((track) => {
      const dotIdx = track.name.indexOf('.');
      const boneName = dotIdx !== -1 ? track.name.substring(0, dotIdx) : track.name;
      if (!boneNames.has(boneName)) return false;

      const property = track.name.substring(dotIdx);
      const isHips = boneName.toLowerCase().includes('hips');

      if (stripScale && property === '.scale') return false;

      if (stripPositions) {
        if (property === '.scale') return false;
        if (property === '.position') return false;
      }

      if (stripRootMotion && isHips && property === '.position') {
        return false;
      }

      return true;
    });

  const matchedBones = new Set<string>();
  remapped.tracks.forEach((track) => {
    const dotIdx = track.name.indexOf('.');
    if (dotIdx !== -1) matchedBones.add(track.name.substring(0, dotIdx));
  });

  const sourceBones = new Set<string>();
  clip.tracks.forEach((track) => {
    const dotIdx = track.name.indexOf('.');
    if (dotIdx !== -1) sourceBones.add(track.name.substring(0, dotIdx));
  });

  const matchRate = sourceBones.size > 0 ? matchedBones.size / sourceBones.size : 0;
  const unmatchedBones = new Set<string>();

  clip.tracks.forEach((track) => {
    const dotIdx = track.name.indexOf('.');
    const boneName = dotIdx !== -1 ? track.name.substring(0, dotIdx) : track.name;
    if (!boneNames.has(boneName) && !normalizedBoneMap.has(normalizeBoneName(boneName).toLowerCase()) && !aliasToModelBone.has(normalizeBoneName(boneName).toLowerCase())) {
      unmatchedBones.add(boneName);
    }
  });

  if (unmatchedBones.size > 0 && matchRate < UMBRAL_WARNING_REMAPPING) {
    console.warn(`remap ${clip.name}: huesos sin match:`, [...unmatchedBones].join(', '));
  }
  if (remapped.tracks.length === 0 && clip.tracks.length > 0) {
    console.warn(`remapAnimationTracks: ${clip.name} — 0/${clip.tracks.length} tracks matched. Esqueleto incompatible.`);
  } else if (matchRate < UMBRAL_WARNING_REMAPPING && clip.tracks.length > 0) {
    console.warn(`remap ${clip.name}: ${remapped.tracks.length}/${clip.tracks.length} tracks (${Math.round(matchRate * 100)}%)`);
  }

  (remapped as unknown as { _matchRate: number })._matchRate = matchRate;
  return remapped;
}

export function collectBoneData(clone: THREE.Object3D, _avatarName?: string) {
  const boneNames = new Set<string>();
  let hipsNode: THREE.Bone | null = null;

  clone.traverse((child) => {
    const c = child as THREE.Bone & { isBone?: boolean };
    if (c.isBone) {
      boneNames.add(c.name);
      if (!hipsNode && normalizeBoneName(c.name).toLowerCase() === 'hips') {
        hipsNode = c;
      }
    }
  });

  const spineChainMap = new Map<string, string>();
  if (hipsNode) {
    const chain: string[] = [];
    let current: THREE.Object3D | null = hipsNode;
    while (current) {
      const spineChild = current.children.find((child) => {
        const c = child as THREE.Bone & { isBone?: boolean };
        if (!c.isBone) return false;
        const normalized = normalizeBoneName(c.name).toLowerCase();
        return normalized.includes('spine') || normalized === 'chest' || normalized === 'upperchest';
      });
      if (!spineChild) break;
      chain.push(spineChild.name);
      current = spineChild;
    }

    const mixamoSpineKeys = ['spine', 'spine1', 'spine2'];
    for (let i = 0; i < Math.min(chain.length, mixamoSpineKeys.length); i++) {
      spineChainMap.set(mixamoSpineKeys[i], chain[i]);
    }
  }

  return { boneNames, spineChainMap };
}
