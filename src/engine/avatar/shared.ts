// Constantes y tipos del avatar — portado de cowork-v3 sin cambios (es genérico, no tiene nada de oficina).
export interface AnimationConfig {
  id: string;
  nombre: string;
  url: string;
  loop: boolean;
  orden: number;
  strip_root_motion?: boolean;
  es_fallback?: boolean;
}

export interface Avatar3DConfig {
  id: string;
  nombre: string;
  modelo_url: string;
  escala: number;
  textura_url?: string | null;
  modelo_url_medium?: string | null;
  modelo_url_low?: string | null;
  textura_url_medium?: string | null;
  textura_url_low?: string | null;
  animaciones?: AnimationConfig[];
}

export type AvatarAssetQuality = 'high' | 'medium' | 'low';

export type AnimationState = 'idle' | 'walk' | 'run' | 'cheer' | 'dance' | 'wave' | 'jump' | 'victory';

export const DEFAULT_MODEL_URL = '/characters/generic-male.glb';

export function resolveAvatarModelUrl(avatarConfig: Avatar3DConfig | null | undefined, quality: AvatarAssetQuality = 'high'): string {
  if (!avatarConfig) return DEFAULT_MODEL_URL;
  if (quality === 'low') return avatarConfig.modelo_url_low || avatarConfig.modelo_url_medium || avatarConfig.modelo_url || DEFAULT_MODEL_URL;
  if (quality === 'medium') return avatarConfig.modelo_url_medium || avatarConfig.modelo_url || DEFAULT_MODEL_URL;
  return avatarConfig.modelo_url || DEFAULT_MODEL_URL;
}

export function resolveAvatarTextureUrl(avatarConfig: Avatar3DConfig | null | undefined, quality: AvatarAssetQuality = 'high'): string | null {
  if (!avatarConfig) return null;
  if (quality === 'low') return avatarConfig.textura_url_low || avatarConfig.textura_url_medium || avatarConfig.textura_url || null;
  if (quality === 'medium') return avatarConfig.textura_url_medium || avatarConfig.textura_url || null;
  return avatarConfig.textura_url || null;
}

export const LOOP_ANIMATIONS: AnimationState[] = ['idle', 'walk', 'run', 'dance'];

export const EMBEDDED_NAME_MAP: Record<string, AnimationState> = {
  idle: 'idle', 'breathing idle': 'idle', 'happy idle': 'idle',
  walk: 'walk', walking: 'walk', 'walk forward': 'walk',
  run: 'run', running: 'run', jog: 'run', 'run forward': 'run', sprint: 'run', sprinting: 'run',
  dance: 'dance', dancing: 'dance', 'hip hop dancing': 'dance', 'samba dancing': 'dance',
  cheer: 'cheer', cheering: 'cheer', 'cheer with both hands': 'cheer',
  wave: 'wave', waving: 'wave', 'wave gesture': 'wave',
  jump: 'jump', jumping: 'jump', 'happy jump': 'jump', 'happy jump f': 'jump',
  victory: 'victory', 'victory cheer': 'victory',
};

export const BONE_ALIASES: Record<string, string[]> = {
  hips: ['hips', 'pelvis', 'root'],
  spine: ['spine'],
  spine1: ['spine1', 'chest'],
  spine2: ['spine2', 'upperchest'],
  neck: ['neck'],
  head: ['head'],
  headtop_end: ['headtop_end', 'headtop', 'head_end', 'headfront'],
  leftshoulder: ['leftshoulder', 'leftcollar', 'l_shoulder', 'shoulder_l'],
  leftarm: ['leftarm', 'leftuparm', 'l_upperarm', 'upperarm_l'],
  leftforearm: ['leftforearm', 'leftlowarm', 'l_forearm', 'forearm_l', 'leftlowerarm'],
  lefthand: ['lefthand', 'l_hand', 'hand_l'],
  rightshoulder: ['rightshoulder', 'rightcollar', 'r_shoulder', 'shoulder_r'],
  rightarm: ['rightarm', 'rightuparm', 'r_upperarm', 'upperarm_r'],
  rightforearm: ['rightforearm', 'rightlowarm', 'r_forearm', 'forearm_r', 'rightlowerarm'],
  righthand: ['righthand', 'r_hand', 'hand_r'],
  leftupleg: ['leftupleg', 'leftthigh', 'l_thigh', 'thigh_l', 'leftupperleg'],
  leftleg: ['leftleg', 'leftcalf', 'l_calf', 'calf_l', 'leftlowerleg', 'leftknee'],
  leftfoot: ['leftfoot', 'l_foot', 'foot_l'],
  lefttoebase: ['lefttoebase', 'lefttoe', 'l_toe', 'toe_l'],
  lefttoe_end: ['lefttoe_end', 'lefttoeend'],
  rightupleg: ['rightupleg', 'rightthigh', 'r_thigh', 'thigh_r', 'rightupperleg'],
  rightleg: ['rightleg', 'rightcalf', 'r_calf', 'calf_r', 'rightlowerleg', 'rightknee'],
  rightfoot: ['rightfoot', 'r_foot', 'foot_r'],
  righttoebase: ['righttoebase', 'righttoe', 'r_toe', 'toe_r'],
  righttoe_end: ['righttoe_end', 'righttoeend'],
};

export const ALTURA_AVATAR_ESTANDAR = 1.75; // metros — altura de referencia del avatar humano
