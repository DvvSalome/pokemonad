// Sube el color base de un GLB sin tocar su geometría ni sus animaciones.
//
//   node scripts/brighten-model.mjs public/monsters/GreenBlob.glb public/characters/blob.glb 3
//
// Hace falta porque algunos modelos del pack de monstruos traen el `baseColorFactor` muy oscuro (el blob
// verde está en 0.037, 0.067, 0.028 lineal, que en pantalla es un verde oliva casi negro). De props
// repartidos por el mundo no se nota, pero el personaje que controlas ocupa el centro de la pantalla y
// ahí sí: se lee como una mancha negra. Multiplicar el factor —acotado a 1— lo devuelve al color del
// render original del autor sin repintar texturas.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [src, out, factorArg] = process.argv.slice(2);
if (!src || !out) {
  console.error('uso: node scripts/brighten-model.mjs <origen.glb> <destino.glb> [factor]');
  process.exit(1);
}
const factor = Number(factorArg ?? 2);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
for (const mat of doc.getRoot().listMaterials()) {
  const [r, g, b, a] = mat.getBaseColorFactor();
  mat.setBaseColorFactor([Math.min(1, r * factor), Math.min(1, g * factor), Math.min(1, b * factor), a]);
}
await io.write(out, doc);
console.log(`${src} -> ${out} (×${factor})`);
