/**
 * Mete el Nature Kit de Kenney (troncos, setas, tocones, estatuas, nenúfares) en la paleta del pack
 * Ultimate Stylized Nature de Quaternius, que es el que define el aspecto del mundo.
 *
 * Hacen falta dos arreglos, y el segundo es la razón de ser del script:
 *
 * 1. El pack trae `metallicFactor = 1` en sus 139 materiales y valores sRGB metidos en `baseColorFactor`,
 *    que glTF define como LINEAL (la corteza viene como 0.886/0.514/0.341, que son los bytes sRGB
 *    226/131/87 divididos por 255). Al remapear la paleta entera esto queda corregido de paso, porque
 *    aquí los colores se declaran en sRGB y se escriben convertidos.
 *
 * 2. La paleta de Kenney no es la del mundo. Sus verdes son turquesa (grass 48,215,183), su piedra es
 *    azul hielo (183,225,231) y su madera es naranja brillante (225,130,88); el pack de Quaternius va de
 *    verde oliva (grass 88,108,31), roca gris cálida (65,67,60) y corteza marrón oscura (137,86,65).
 *    Con las dos paletas juntas la decoración no parecía decoración: parecía de otro juego. Los objetivos
 *    de abajo salen de medir el color medio de las texturas del pack nuevo, no de elegir a ojo.
 *
 * Los materiales de Kenney son colores planos sin textura, así que remapear es literalmente reescribir
 * un color por material. Es idempotente: cada material acaba en un valor constante.
 *
 *   node scripts/harmonize-nature-pack.mjs public/nature
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/**
 * Nombre de material de Kenney -> color sRGB destino. Las referencias entre paréntesis son el color medio
 * medido en la textura correspondiente del pack de Quaternius.
 */
const PALETTE = {
  // Maderas: al marrón de NormalTree_Bark (137,86,65), escalonadas para no perder el contraste interno
  // que el pack usaba entre corteza, corteza oscura y madera cortada.
  woodBark: 0x8a5641,
  woodBarkDark: 0x6c4636,
  wood: 0x986550,
  woodDark: 0x64402f,
  woodInner: 0xba936e,
  // El abedul de Quaternius no es blanco crema sino gris pálido (144,136,131).
  woodBirch: 0xb4aca4,
  dirt: 0x7c5a3e,

  // Verdes: de turquesa a la gama oliva del pack (Grass 88,108,31 / Leaves 126,206,0).
  grass: 0x6ca02a,
  leafsGreen: 0x6eaf1e,
  leafsDark: 0x4a7c22,
  // El otoño reutiliza el rojo del arce (206,89,62) para que la caída de hoja sea un solo color.
  leafsFall: 0xce593e,

  // Piedra: de azul hielo al gris cálido de Rock (65,67,60), aclarado para que la estatuaria se lea.
  stone: 0x76786e,
  stoneDark: 0x52544c,

  // Acentos. Se mantienen saturados porque son el color de las setas y los cristales, pero bajados de
  // brillo: el mundo va sin tone mapping, así que un valor cerca del blanco se quema.
  colorTan: 0xbe9664,
  colorYellow: 0xe0a834,
  colorRed: 0xbe403e,
  colorRedDark: 0x9e3030,
  colorPurple: 0x8c76cd,
  _defaultMat: 0xe1ded7,
};

const dir = process.argv[2] ?? 'public/nature';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearRGB = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255].map(toLinear);

let materials = 0;
const unknown = new Set();
const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));

for (const name of files) {
  const path = join(dir, name);
  const doc = await io.read(path);

  for (const material of doc.getRoot().listMaterials()) {
    const key = material.getName();
    const hex = PALETTE[key];
    if (hex === undefined) {
      unknown.add(key);
      continue;
    }
    const [r, g, b] = linearRGB(hex);
    material.setBaseColorFactor([r, g, b, material.getBaseColorFactor()[3]]);
    material.setMetallicFactor(0);
    material.setRoughnessFactor(0.9);
    materials++;
  }

  await io.write(path, doc);
}

console.log(`${materials} materiales remapeados en ${files.length} archivos.`);
if (unknown.size) console.log(`Sin entrada en PALETTE (quedaron sin tocar): ${[...unknown].join(', ')}`);
