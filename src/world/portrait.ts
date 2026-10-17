// Retratos 3D de los monstruos para las cartas, portado de research/pokegrass-source/js/thumbs.js: un
// renderer offscreen propio (fuera del <Canvas> de R3F) dibuja cada GLB una vez sobre fondo transparente
// y lo cachea como PNG (dataURL). Se usa en la carta coleccionable (cardCanvas.ts). Un solo contexto WebGL
// extra, creado perezosamente y reutilizado — igual que el original.
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { SkeletonUtils } from 'three-stdlib';
import { toonifyObject, occluder } from './toon';
import { paletteFor, naturalPalette, shinyPalette, applyPalette } from './tokenLook';

/** Colores del ejemplar: los de su token (logo/símbolo) y si es shiny. */
export interface PortraitLook { logo?: string; symbol?: string; shiny?: boolean; /** Encuadre de busto (retratos de entrenador) en vez de cuerpo entero. */ bust?: boolean }

const loader = new GLTFLoader();
const gltfCache = new Map<string, Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>>();
function loadGLB(url: string) {
  let p = gltfCache.get(url);
  if (!p) {
    p = new Promise((ok, no) => loader.load(url, (g) => ok({ scene: g.scene, animations: g.animations }), undefined, no));
    gltfCache.set(url, p);
  }
  return p;
}

const S = 640;
let r: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene, cam: THREE.PerspectiveCamera;
function setup() {
  if (r) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(S, S, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe3f2ff, 0x7aa05e, 1.6));
  const d = new THREE.DirectionalLight(0xfff3e0, 2.6);
  d.position.set(2.5, 4, 5);
  scene.add(d);
  const back = new THREE.DirectionalLight(0xbfe3ff, 1.2);
  back.position.set(-3, 2, -4);
  scene.add(back);
  cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
}

const cache = new Map<string, Promise<string>>();

/** PNG (dataURL) de un retrato 3D del modelo, encuadrado de cuerpo entero sobre fondo transparente. */
export function portrait(model: string, look: PortraitLook = {}): Promise<string> {
  const key = `${model}|${look.logo || look.symbol || ''}|${look.shiny ? 1 : 0}|${look.bust ? 'b' : ''}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const p = render(model, look).catch(() => '');
  cache.set(key, p);
  return p;
}

async function render(model: string, look: PortraitLook): Promise<string> {
  setup();
  const [gltf, pal] = await Promise.all([loadGLB(model), look.symbol ? paletteFor(look.logo, look.symbol) : Promise.resolve(null)]);
  const root = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
  toonifyObject(root, { outline: 0.02, rim: 0.14 });
  const base = pal ?? (look.shiny ? naturalPalette(root) : null);
  if (base) applyPalette(root, look.shiny ? shinyPalette(base) : base);
  // Una pose de reposo (avanza un poco el mixer para que no salga en T-pose).
  if (gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(root);
    const clip = gltf.animations.find((a) => /Idle/i.test(a.name)) || gltf.animations.find((a) => /Swimming_Normal|Flying/i.test(a.name)) || gltf.animations[0];
    mixer.clipAction(clip).play();
    mixer.update(0.4);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const h = Math.max(0.01, size.y);
  const m = Math.max(h, Math.min(Math.max(size.x * 0.95, size.z * 0.7), h * 1.45));
  if (look.bust) {
    const cy = box.max.y - h * 0.3;
    cam.position.set(mid.x + h * 0.2, cy + h * 0.05, mid.z + h * 1.3);
    cam.lookAt(mid.x, cy, mid.z);
  } else {
    cam.position.set(mid.x + m * 0.7, mid.y + h * 0.12, m * 2.4 + 0.8);
    cam.lookAt(mid.x, mid.y, mid.z);
  }
  scene!.add(root);
  // El oclusor (toon.ts) usa uniformes globales: si está activo, su cono cámara→jugador podría recortar
  // fragmentos del retrato. Lo apagamos alrededor del render síncrono y lo restauramos (no hay await en
  // medio, así que el bucle del mundo no corre entre estas líneas).
  const occWas = occluder.uOccOn.value;
  occluder.uOccOn.value = 0;
  r!.render(scene!, cam);
  occluder.uOccOn.value = occWas;
  const url = r!.domElement.toDataURL('image/png');
  scene!.remove(root);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mm) => mm?.dispose?.());
    }
  });
  return url;
}
