/**
 * Imprime el tamaño real en metros (con las transformaciones de nodo aplicadas) de cada GLB que se le
 * pase. Sirve para cazar props con la escala equivocada sin tener que abrirlos en el navegador.
 *
 *   node scripts/measure.mjs public/nature/log.glb public/nature/lily_large.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const path of process.argv.slice(2)) {
  const doc = await io.read(path);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const materials = new Set();

  const walk = (node, parent) => {
    const m = mul(parent, local(node));
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        if (mat) materials.add(`${mat.getName()}[${mat.getAlphaMode()}]`);
        const pos = prim.getAttribute('POSITION');
        for (let i = 0; i < pos.getCount(); i++) {
          const v = pos.getElement(i, [0, 0, 0]);
          const w = apply(m, v);
          for (let k = 0; k < 3; k++) {
            if (w[k] < min[k]) min[k] = w[k];
            if (w[k] > max[k]) max[k] = w[k];
          }
        }
      }
    }
    for (const child of node.listChildren()) walk(child, m);
  };
  for (const node of scene.listChildren()) walk(node, identity());

  const size = [0, 1, 2].map((k) => +(max[k] - min[k]).toFixed(3));
  console.log(`${path}\n  size x/y/z: ${size.join(' / ')}  base y: ${min[1].toFixed(3)}`);
  console.log(`  nodes: ${scene.listChildren().map((n) => n.getName()).join(', ')}`);
  console.log(`  materials: ${[...materials].join(', ')}\n`);
}

function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function local(node) {
  const [tx, ty, tz] = node.getTranslation();
  const [x, y, z, w] = node.getRotation();
  const [sx, sy, sz] = node.getScale();
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  return [
    r[0] * sx, r[1] * sx, r[2] * sx, 0,
    r[3] * sy, r[4] * sy, r[5] * sy, 0,
    r[6] * sz, r[7] * sz, r[8] * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += b[c * 4 + k] * a[k * 4 + r];
    }
  }
  return out;
}

function apply(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}
