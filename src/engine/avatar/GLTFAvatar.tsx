'use client';
// El renderizador del avatar: carga el GLTF, clona el esqueleto, remapea animaciones al esqueleto del
// modelo (sean propias o "universales" de otro esqueleto), hace crossfade entre estados, y mide su
// propia altura (para poner la etiqueta encima) sin reescalar. Portado de cowork-v3 quitando toda
// la lógica de sentarse en sillas (isSitting/sitRotation) — no aplica a un mundo abierto sin muebles.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils, GLTFLoader } from 'three-stdlib';
import { supabase } from '@/lib/supabase';
import { collectBoneData, remapAnimationTracks } from './rigUtils';
import {
  DEFAULT_MODEL_URL,
  EMBEDDED_NAME_MAP,
  LOOP_ANIMATIONS,
  resolveAvatarModelUrl,
  resolveAvatarTextureUrl,
  type AvatarAssetQuality,
  type AnimationState,
  type Avatar3DConfig,
} from './shared';

export interface GLTFAvatarProps {
  avatarConfig?: Avatar3DConfig | null;
  animationState?: AnimationState;
  /** Ref al ángulo de cara en radianes (espacio mundo), típicamente Math.atan2(dx, dz) del vector de
   * movimiento — leído dentro del propio useFrame para no forzar un re-render de React cada frame
   * mientras el jugador se mueve. Reemplaza el viejo sistema de 8 direcciones con signos fáciles de
   * invertir por error. */
  facingAngleRef?: React.MutableRefObject<number>;
  skinColor?: string;
  clothingColor?: string;
  scale?: number;
  onHeightComputed?: (height: number) => void;
  assetQuality?: AvatarAssetQuality;
  /** Silueta visible a través de lo que lo tape (árboles, rocas, muros): el personaje nunca se pierde. */
  xray?: boolean;
}

// Orden de pintado para la silueta: después del mundo (renderOrder 0) y antes del propio avatar, así la
// prueba de profundidad "más lejos que lo ya pintado" solo la pasan las partes que tapa el mundo, nunca
// las que tapa el propio cuerpo (su profundidad aún no está escrita).
const XRAY_ORDER = 10;
const AVATAR_ORDER = 20;

const xrayMaterial = new THREE.MeshBasicMaterial({
  color: '#8fdcff',
  opacity: 0.5,
  // Opaco para three (va en la lista opaca, respetando renderOrder) pero mezclado a mano.
  transparent: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  depthFunc: THREE.GreaterDepth,
  depthWrite: false,
  fog: false,
});

/** Copias de las mallas con esqueleto que comparten huesos con el original y pintan solo la parte tapada. */
function buildXray(root: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  root.traverse((child: any) => {
    if (!child.isSkinnedMesh) return;
    const ghost = new THREE.SkinnedMesh(child.geometry, xrayMaterial);
    ghost.bind(child.skeleton, child.bindMatrix);
    ghost.frustumCulled = false;
    ghost.renderOrder = XRAY_ORDER;
    ghost.castShadow = false;
    ghost.receiveShadow = false;
    group.add(ghost);
  });
  return group;
}

useGLTF.setDecoderPath('/draco/');

const animationAssetCache = new Map<string, Promise<THREE.AnimationClip[]>>();
const textureAssetCache = new Map<string, Promise<THREE.Texture>>();

function loadAnimationAsset(url: string, loader: GLTFLoader): Promise<THREE.AnimationClip[]> {
  const cached = animationAssetCache.get(url);
  if (cached) return cached;
  const pending = loader.loadAsync(url).then((gltf) => gltf.animations);
  animationAssetCache.set(url, pending);
  return pending;
}

function loadTextureAsset(url: string, loader: THREE.TextureLoader): Promise<THREE.Texture> {
  const cached = textureAssetCache.get(url);
  if (cached) return cached;
  const pending = new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      url,
      (texture) => { texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; resolve(texture); },
      undefined,
      (error) => { textureAssetCache.delete(url); reject(error); },
    );
  });
  textureAssetCache.set(url, pending);
  return pending;
}

const GLTFAvatarInner: React.FC<GLTFAvatarProps> = ({
  avatarConfig,
  animationState = 'idle',
  facingAngleRef,
  skinColor,
  clothingColor,
  scale = 1,
  onHeightComputed,
  assetQuality = 'high',
  xray = false,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const [currentAnimation, setCurrentAnimation] = useState<AnimationState>('idle');
  const [externalTexture, setExternalTexture] = useState<THREE.Texture | null>(null);
  const [loadedAnimClips, setLoadedAnimClips] = useState<Record<string, THREE.AnimationClip>>({});
  const animConfigRef = useRef('');
  const currentAvatarIdRef = useRef('');
  const heightComputedRef = useRef(false);
  const frameCountRef = useRef(0);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const pendingAnimRef = useRef<{ anim: AnimationState; timer: ReturnType<typeof setTimeout> } | null>(null);
  const targetQuaternion = useRef(new THREE.Quaternion());
  const textureLoadErrorLogRef = useRef<Record<string, true>>({});
  const lowMatchDiscardLogRef = useRef<Record<string, true>>({});

  const modelUrl = resolveAvatarModelUrl(avatarConfig, assetQuality);
  const { scene, animations: baseAnimations } = useGLTF(modelUrl);

  useEffect(() => { useGLTF.preload(modelUrl); }, [modelUrl]);

  const clone = useMemo(() => {
    let hasSkinnedMesh = false;
    scene.traverse((child: any) => { if (child.isSkinnedMesh) hasSkinnedMesh = true; });

    const clonedScene = hasSkinnedMesh ? SkeletonUtils.clone(scene) : scene.clone(true);

    clonedScene.traverse((child: any) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.material) {
        child.material = Array.isArray(child.material)
          ? child.material.map((material: any) => material.clone())
          : child.material.clone();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material: any) => {
          if (material.vertexColors) material.vertexColors = false;
          if (material.map) { material.map.needsUpdate = true; material.color = new THREE.Color(0xffffff); }
          if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
            material.metalness = 0.0;
            material.roughness = 1.0;
            material.envMapIntensity = 0.0;
            if (material.emissiveMap || material.emissive.getHex() !== 0x000000) {
              material.emissive = new THREE.Color(0x000000);
              material.emissiveIntensity = 0;
            }
          }
          if (material.transparent) { material.transparent = false; material.alphaTest = 0.5; material.depthWrite = true; }
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        });
        child.castShadow = true;
        child.receiveShadow = false;
        child.renderOrder = AVATAR_ORDER;
      }
    });

    return clonedScene;
  }, [scene, avatarConfig?.nombre]);

  const xrayGroup = useMemo(() => (xray ? buildXray(clone) : null), [clone, xray]);

  const { boneNames, spineChainMap } = useMemo(() => collectBoneData(clone, avatarConfig?.nombre), [clone, avatarConfig?.nombre]);

  useFrame(() => {
    if (heightComputedRef.current || !groupRef.current || !onHeightComputed) return;
    frameCountRef.current += 1;
    if (frameCountRef.current < 5) return;

    let targetBone: THREE.Object3D | null = null;
    let fallbackBoneY = 0;

    clone.traverse((child: any) => {
      if (child.isBone) {
        const name = child.name.toLowerCase();
        if (name.includes('headtop_end')) targetBone = child;
        else if (!targetBone && name.includes('head')) targetBone = child;
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        if (pos.y > fallbackBoneY) fallbackBoneY = pos.y;
      }
    });

    const rootPos = new THREE.Vector3();
    groupRef.current.getWorldPosition(rootPos);
    let worldHeight = 0;

    if (targetBone) {
      const bonePos = new THREE.Vector3();
      (targetBone as THREE.Object3D).getWorldPosition(bonePos);
      worldHeight = bonePos.y - rootPos.y;
    } else {
      const box = new THREE.Box3().setFromObject(clone);
      worldHeight = box.max.y - box.min.y;
      if (worldHeight < 0.1 && fallbackBoneY > 0) worldHeight = fallbackBoneY - rootPos.y;
    }

    // Solo se mide: reescalar aquí haría que un avatar con onHeightComputed (los remotos) saliera de otro
    // tamaño que el del jugador local, que no lo pasa.
    if (worldHeight > 0.1) {
      heightComputedRef.current = true;
      onHeightComputed(worldHeight);
    }
  });

  useEffect(() => {
    const textureUrl = resolveAvatarTextureUrl(avatarConfig, assetQuality);
    if (!textureUrl) { setExternalTexture(null); return; }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loadTextureAsset(textureUrl, loader)
      .then((texture) => { if (!cancelled) setExternalTexture(texture); })
      .catch(() => {
        if (!textureLoadErrorLogRef.current[textureUrl]) {
          console.warn('Error cargando textura:', textureUrl);
          textureLoadErrorLogRef.current[textureUrl] = true;
        }
        if (!cancelled) setExternalTexture(null);
      });
    return () => { cancelled = true; };
  }, [avatarConfig, assetQuality]);

  useEffect(() => {
    if (!externalTexture) return;
    clone.traverse((child: any) => {
      if (child.isMesh || child.isSkinnedMesh) {
        const material = child.material as THREE.MeshStandardMaterial;
        if (!material) return;
        material.map = externalTexture;
        material.metalness = 0;
        material.roughness = 1.0;
        material.side = THREE.DoubleSide;
        if (material.transparent) { material.transparent = false; material.alphaTest = 0.5; material.depthWrite = true; }
        material.needsUpdate = true;
      }
    });
  }, [clone, externalTexture]);

  useEffect(() => {
    const newId = avatarConfig?.id || '_default_';
    if (newId !== currentAvatarIdRef.current) {
      currentAvatarIdRef.current = '';
      animConfigRef.current = '';
      setLoadedAnimClips({});
      heightComputedRef.current = false;
      frameCountRef.current = 0;
    }
  }, [avatarConfig?.id]);

  useEffect(() => {
    currentAvatarIdRef.current = '';
    animConfigRef.current = '';
    setLoadedAnimClips({});
    heightComputedRef.current = false;
    frameCountRef.current = 0;
  }, [modelUrl]);

  useEffect(() => {
    if (boneNames.size === 0) return;
    const avatarId = avatarConfig?.id;
    if (avatarId === 'default') return;

    const cacheKey = avatarId || '_default_';
    if (cacheKey === currentAvatarIdRef.current) return;

    if (baseAnimations.length > 1) {
      currentAvatarIdRef.current = cacheKey;
      setLoadedAnimClips({});
      return;
    }

    let cancelled = false;

    const loadAnimations = async () => {
      let animaciones = avatarConfig?.animaciones;
      let isCrossSkeleton = false;

      if (animaciones && animaciones.length > 0 && (animaciones as any[])[0]?.es_fallback) {
        isCrossSkeleton = true;
      }

      if (!animaciones || animaciones.length === 0) return;

      const configKey = animaciones.map((anim) => anim.url).join('|');
      if (configKey === animConfigRef.current) return;
      animConfigRef.current = configKey;
      currentAvatarIdRef.current = cacheKey;

      const loader = new GLTFLoader();
      const results = await Promise.all(
        animaciones.map(async (anim) => {
          try {
            const clipsForUrl = await loadAnimationAsset(anim.url, loader);
            return { nombre: anim.nombre, clips: clipsForUrl, strip: anim.strip_root_motion ?? false, isUniversal: isCrossSkeleton };
          } catch (err) {
            if (!textureLoadErrorLogRef.current[anim.url]) {
              console.warn(`Error loading ${anim.nombre}:`, err);
              textureLoadErrorLogRef.current[anim.url] = true;
            }
            return null;
          }
        }),
      );

      if (cancelled || currentAvatarIdRef.current !== cacheKey) return;

      const clips: Record<string, THREE.AnimationClip> = {};
      results.forEach((result) => {
        if (result && result.clips.length > 0) {
          const clip = remapAnimationTracks(result.clips[0], boneNames, result.strip, spineChainMap, result.isUniversal, result.isUniversal);
          const matchRate = (clip as any)._matchRate ?? 0;
          if (matchRate < 0.3 && result.clips[0].tracks.length > 0) {
            if (!lowMatchDiscardLogRef.current[result.nombre]) {
              console.warn(`${result.nombre}: solo ${Math.round(matchRate * 100)}% tracks matched — descartada`);
              lowMatchDiscardLogRef.current[result.nombre] = true;
            }
            return;
          }
          clip.name = result.nombre;
          clips[result.nombre] = clip;
        }
      });

      if (cancelled || currentAvatarIdRef.current !== cacheKey) return;
      setLoadedAnimClips(clips);
    };

    loadAnimations();
    return () => { cancelled = true; };
  }, [avatarConfig?.id, avatarConfig?.animaciones, avatarConfig?.nombre, boneNames, baseAnimations, spineChainMap]);

  const allAnimations = useMemo(() => {
    const animations: THREE.AnimationClip[] = [];

    if (baseAnimations.length > 1 && Object.keys(loadedAnimClips).length === 0) {
      const matched: (AnimationState | undefined)[] = baseAnimations.map((clip) => {
        const lower = clip.name.toLowerCase().trim();
        let state: AnimationState | undefined = EMBEDDED_NAME_MAP[lower];
        if (!state) {
          for (const [key, value] of Object.entries(EMBEDDED_NAME_MAP)) {
            if (lower.includes(key)) { state = value as AnimationState; break; }
          }
        }
        return state;
      });
      // Only treat clip 0 as idle when NOTHING in the set matched an idle name — some rigs export
      // clips alphabetically (e.g. "Grounded, Idle, Jump, Sprint, Walk"), so an unrecognized clip 0
      // must not steal the idle slot from a real Idle clip sitting later in the array: that's what
      // made a landing/settle pose loop in place and read as constant jumping.
      if (!matched.some((s) => s === 'idle') && !matched[0]) matched[0] = 'idle';

      const used = new Set<AnimationState>();
      baseAnimations.forEach((clip, idx) => {
        const state = matched[idx];
        if (!state || used.has(state)) return;
        used.add(state);
        const stripRootMotion = state === 'walk' || state === 'run';
        const remapped = remapAnimationTracks(clip, boneNames, stripRootMotion, spineChainMap, false, true);
        remapped.name = state;
        animations.push(remapped);
      });
      return animations;
    }

    if (loadedAnimClips.idle) animations.push(loadedAnimClips.idle);
    else if (baseAnimations.length > 0) {
      const clip = remapAnimationTracks(baseAnimations[0], boneNames, false, spineChainMap);
      clip.name = 'idle';
      animations.push(clip);
    }

    Object.entries(loadedAnimClips).forEach(([name, clip]) => { if (name !== 'idle') animations.push(clip); });
    return animations;
  }, [baseAnimations, boneNames, loadedAnimClips, spineChainMap]);

  useEffect(() => {
    if (!groupRef.current) return;
    const mixer = new THREE.AnimationMixer(groupRef.current);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      if (groupRef.current) mixer.uncacheRoot(groupRef.current);
      mixerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mixer = mixerRef.current;
    const root = groupRef.current;
    if (!mixer || !root || allAnimations.length === 0) return;

    mixer.stopAllAction();
    Object.values(actionsRef.current).forEach((action) => mixer.uncacheAction(action.getClip(), root));

    const newActions: Record<string, THREE.AnimationAction> = {};
    allAnimations.forEach((clip) => { newActions[clip.name] = mixer.clipAction(clip, root); });
    actionsRef.current = newActions;

    if (newActions.idle) newActions.idle.reset().fadeIn(0.2).play();
    setCurrentAnimation('idle');
  }, [allAnimations]);

  useFrame((_, delta) => { mixerRef.current?.update(delta); });

  useEffect(() => {
    const actions = actionsRef.current;
    if (Object.keys(actions).length === 0) return;

    const targetAnim = animationState;
    if (currentAnimation === targetAnim) {
      if (pendingAnimRef.current) { clearTimeout(pendingAnimRef.current.timer); pendingAnimRef.current = null; }
      return;
    }

    const animationFallbacks: Record<string, string[]> = {
      cheer: ['wave', 'dance', 'victory', 'idle'],
      wave: ['cheer', 'idle'],
      // El goblin no trae Wave ni Dance: celebra saltando. Sin este respaldo se quedaría quieto al ganar.
      victory: ['cheer', 'wave', 'dance', 'jump', 'idle'],
      jump: ['cheer', 'idle'],
      attack: ['jump', 'idle'],
      hurt: ['idle'],
      death: ['idle'],
      dance: ['idle'],
      walk: ['idle'],
      run: ['walk', 'idle'],
    };

    const resolveAnim = (anim: string): string => {
      if (actions[anim]) return anim;
      const fallbacks = animationFallbacks[anim] || ['idle'];
      for (const fallback of fallbacks) if (actions[fallback]) return fallback;
      return currentAnimation;
    };

    const resolvedAnim = resolveAnim(targetAnim) as AnimationState;
    const CROSSFADE_FAST = 0.15;
    const CROSSFADE_SMOOTH = 0.3;
    const IDLE_DEBOUNCE_MS = 100;

    const applyTransition = (fadeDuration: number) => {
      pendingAnimRef.current = null;
      const current = actions[currentAnimation];
      if (current) current.fadeOut(fadeDuration);
      const next = actions[resolvedAnim];
      if (next) {
        next.reset();
        next.setLoop(
          LOOP_ANIMATIONS.includes(resolvedAnim) ? THREE.LoopRepeat : THREE.LoopOnce,
          LOOP_ANIMATIONS.includes(resolvedAnim) ? Infinity : 1,
        );
        next.clampWhenFinished = !LOOP_ANIMATIONS.includes(resolvedAnim);
        // Correr sin clip de run reutiliza el paso: se acelera para que los pies acompañen al desplazamiento.
        next.timeScale = targetAnim === 'run' ? (resolvedAnim === 'run' ? 1.22 : 1.85) : targetAnim === 'walk' ? 1.28 : 1;
        next.fadeIn(fadeDuration).play();
        setCurrentAnimation(resolvedAnim);
      }
    };

    if (pendingAnimRef.current) { clearTimeout(pendingAnimRef.current.timer); pendingAnimRef.current = null; }

    const isReturningToIdle = targetAnim === 'idle' && (currentAnimation === 'walk' || currentAnimation === 'run');

    if (isReturningToIdle) {
      pendingAnimRef.current = { anim: targetAnim, timer: setTimeout(() => applyTransition(CROSSFADE_SMOOTH), IDLE_DEBOUNCE_MS) };
    } else {
      const isStartingMovement = (targetAnim === 'walk' || targetAnim === 'run') && currentAnimation === 'idle';
      applyTransition(isStartingMovement ? CROSSFADE_FAST : CROSSFADE_SMOOTH);
    }

    return () => {
      if (pendingAnimRef.current) { clearTimeout(pendingAnimRef.current.timer); pendingAnimRef.current = null; }
    };
  }, [animationState, currentAnimation, allAnimations]);

  useEffect(() => {
    if (!clone || (!skinColor && !clothingColor)) return;
    clone.traverse((child: any) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.material) {
        const material = child.material as THREE.MeshStandardMaterial;
        const meshName = child.name.toLowerCase();
        if (skinColor && (meshName.includes('skin') || meshName.includes('head') || meshName.includes('face'))) {
          material.color = new THREE.Color(skinColor);
          material.needsUpdate = true;
        }
        if (clothingColor && (meshName.includes('body') || meshName.includes('cloth') || meshName.includes('shirt'))) {
          material.color = new THREE.Color(clothingColor);
          material.needsUpdate = true;
        }
      }
    });
  }, [clone, skinColor, clothingColor]);

  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    targetQuaternion.current.setFromAxisAngle(yAxis, facingAngleRef?.current ?? Math.PI);
    const lerpFactor = 1 - Math.pow(1 - 0.25, delta * 60);
    groupRef.current.quaternion.slerp(targetQuaternion.current, lerpFactor);
  });

  const avatarScale = (avatarConfig?.escala || 1) * scale;

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <group scale={[avatarScale, avatarScale, avatarScale]}>
        <primitive object={clone} />
        {xrayGroup && <primitive object={xrayGroup} />}
      </group>
    </group>
  );
};

interface AvatarErrorBoundaryProps {
  fallbackConfig: Avatar3DConfig;
  children: React.ReactNode;
  avatarProps: GLTFAvatarProps;
}
interface AvatarErrorBoundaryState { hasError: boolean }

class AvatarErrorBoundary extends React.Component<AvatarErrorBoundaryProps, AvatarErrorBoundaryState> {
  constructor(props: AvatarErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any) { console.error('GLTFAvatar crash. Usando avatar fallback.', error?.message || error); }
  render() {
    if (this.state.hasError) {
      const { avatarProps, fallbackConfig } = this.props;
      return <GLTFAvatarInner {...avatarProps} avatarConfig={fallbackConfig} />;
    }
    return this.props.children;
  }
}

export const GLTFAvatar: React.FC<GLTFAvatarProps> = (props) => {
  const fallbackConfig: Avatar3DConfig = { id: 'default', nombre: 'Default', modelo_url: DEFAULT_MODEL_URL, escala: 1 };
  return (
    <AvatarErrorBoundary fallbackConfig={fallbackConfig} avatarProps={props}>
      <GLTFAvatarInner key={props.avatarConfig?.modelo_url || 'default'} {...props} />
    </AvatarErrorBoundary>
  );
};

useGLTF.preload(DEFAULT_MODEL_URL);
