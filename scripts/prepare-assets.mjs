// Prepara un pack de GLB descargado para servirlo al navegador.
//
//   node scripts/prepare-assets.mjs ../assets/stylized-nature public/stylized
//
// Hace tres cosas, en este orden:
//   1. Quita el slot de normal map (y el de oclusión) de cada material. Bajo cel-shading la luz cae en
//      bandas duras, así que el microrrelieve que codifica una normal map no llega a verse — pero pesa
//      cerca de 1 MB por árbol. En el pack Ultimate Stylized Nature eran ~10 de sus 23 MB.
//   2. Corrige metalness. El pack exporta metalness 0.4 en assets de naturaleza, que es lo que dejaba
//      árboles y rocas con brillo de plástico. El material toon lo descarta igualmente, pero dejarlo
//      correcto en el asset evita que sorprenda a quien lo abra.
//   3. dedup + prune para soltar lo que quedó huérfano, y recomprime las texturas a WebP.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress } from '@gltf-transform/functions';
import { readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [srcDir, outDir, maxTex] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('uso: node scripts/prepare-assets.mjs <dir-origen> <dir-destino> [lado-máximo-de-textura]');
  process.exit(1);
}
// Lado máximo de textura, opcional. Los packs grandes (MegaKit) traen un atlas de 1024 por modelo, y son
// decenas de modelos compartiendo el mismo atlas: a 512 el estilo cel-shaded no pierde nada y el pack baja
// de 13 MB a 4.
const texSide = maxTex ? Number(maxTex) : 0;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(outDir, { recursive: true });

const files = (await readdir(srcDir)).filter((f) => f.endsWith('.glb'));
let before = 0;
let after = 0;

for (const file of files) {
  const srcPath = path.join(srcDir, file);
  const outPath = path.join(outDir, file);
  const doc = await io.read(srcPath);

  let stripped = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getNormalTexture()) { mat.setNormalTexture(null); stripped++; }
    if (mat.getOcclusionTexture()) mat.setOcclusionTexture(null);
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(0.9);
  }

  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, ...(texSide ? { resize: [texSide, texSide] } : {}) }),
  );
  await io.write(outPath, doc);

  const a = (await stat(srcPath)).size;
  const b = (await stat(outPath)).size;
  before += a;
  after += b;
  console.log(`${file.padEnd(16)} ${String(Math.round(a / 1024)).padStart(6)}KB -> ${String(Math.round(b / 1024)).padStart(6)}KB  (normal maps quitados: ${stripped})`);
}

console.log(`\ntotal ${Math.round(before / 1024 / 1024)}MB -> ${Math.round(after / 1024 / 1024)}MB`);
