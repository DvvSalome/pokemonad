// Estado de luz compartido, escrito por DayNightCycle y leído por los shaders propios (hierba, agua).
//
// Los materiales de three reciben la luz de la escena solos, pero nuestros ShaderMaterial a medida no:
// sin esto la hierba se queda verde brillante a medianoche mientras el resto del mundo oscurece. Es un
// objeto mutable a propósito, siguiendo el patrón ref-first del resto del proyecto — se escribe y se lee
// una vez por frame, y meterlo en estado de React provocaría un re-render por frame.
import * as THREE from 'three';

export const SUN = {
  /** Color de la luz direccional. */
  color: new THREE.Color('#ffeec4'),
  intensity: 1.6,
  /** Color de la luz ambiental. */
  ambient: new THREE.Color('#93a6dc'),
  ambientIntensity: 0.42,
};

/**
 * Paleta del cielo, también escrita por DayNightCycle. Antes el cielo y la niebla eran constantes fijas
 * mientras las luces sí seguían la hora, así que de noche el mundo se oscurecía contra un cielo de
 * mediodía y la niebla del horizonte no pegaba con nada.
 */
export const SKY = {
  top: new THREE.Color('#2457a8'),
  horizon: new THREE.Color('#a9e6d8'),
  /** La niebla iguala al horizonte: es lo que hace que la distancia se disuelva en el cielo. */
  fog: new THREE.Color('#a9e6d8'),
  /** Resplandor que la niebla y el horizonte suman en dirección al sol (perspectiva aérea). */
  glow: new THREE.Color('#3a2c1c'),
  /**
   * Dirección del sol VISIBLE en la cúpula. Se separa de la direccional a propósito: la luz que da sombra
   * no se mueve (encaje a texel, ver DayNightCycle), el disco sí recorre el cielo con la hora.
   */
  sunDir: new THREE.Vector3(52, 74, 38).normalize(),
  moonDir: new THREE.Vector3(-0.4, 0.5, 0.7).normalize(),
  /** 0 de día, 1 de noche cerrada. */
  night: 0,
  /** 0..1, pico con el sol cerca del horizonte: rayos, nubes teñidas. */
  golden: 0,
};

/**
 * Factor de iluminación plano para shaders sin cálculo de luz: mezcla sol y ambiente en un solo color
 * multiplicador. No es físicamente correcto, pero mantiene la hierba y el agua en sintonía con la hora.
 */
export function flatLight(out: THREE.Color): THREE.Color {
  out.copy(SUN.color).multiplyScalar(0.55 * SUN.intensity);
  const a = SUN.ambientIntensity * 1.1;
  out.r += SUN.ambient.r * a;
  out.g += SUN.ambient.g * a;
  out.b += SUN.ambient.b * a;
  // Sin techo, el mediodía quema el color base de la hierba a blanco.
  out.r = Math.min(1.15, out.r);
  out.g = Math.min(1.15, out.g);
  out.b = Math.min(1.15, out.b);
  return out;
}
