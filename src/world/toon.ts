// El sombreado de todo el mundo, en un solo sitio.
//
// HISTORIA: esto nació como el cel shading del juego original (rampa de 4 bandas duras + contorno
// marrón por casco invertido), que es exactamente la firma visual de aquel juego. Este proyecto tiene que
// parecer otro, así que la dirección de arte cambió a "diorama de arcilla": la luz cae en una rampa
// SUAVE con las sombras levantadas (volumen redondo, como plastilina bajo un foco), sin contornos, y la
// profundidad la ponen la oclusión ambiental, el tone mapping y el desenfoque tilt-shift del postproceso
// (ver Scene.tsx). Las funciones conservan el nombre `toon*` para no tocar a sus cien llamadores: lo que
// cambia es lo que devuelven.
//
// Por qué importa: los GLB de naturaleza vienen con metalness 0.4 y normal maps, que bajo PBR los
// dejan plásticos y ruidosos. Al convertirlos a toon se descarta metalness/roughness/normalMap y solo
// sobrevive el color base + su textura, que es justo la información que el estilo necesita.
import * as THREE from 'three';

/**
 * Fade de oclusores, portado de research/pokegrass-source/js/scene.js: lo que se interpone entre la
 * cámara y el jugador se desvanecía con un recorte, para que la vista no se llene de copa.
 *
 * DESACTIVADO a propósito (uOccOn se queda en 0, ya no hay componente que lo encienda). Se midió que al
 * mover la cámara sus agujeros dejaban ver el fondo claro y ESO era una de las dos fuentes del parpadeo
 * blanco. Se deja el andamiaje del shader (inerte con uOccOn=0) por si más adelante se reimplementa con
 * una técnica que no descarte fragmentos (p.ej. desvanecer hacia el color de niebla en vez de agujerear).
 */
export const occluder = {
  uOccB: { value: new THREE.Vector3(0, -999, 0) },
  uOccOn: { value: 0 },
};

/**
 * Interruptores de la dirección de arte. `outlines` en false apaga el contorno por casco invertido en todo
 * el mundo (instancing.ts y toonifyObject lo consultan): el trazo marrón alrededor de cada roca y cada
 * monstruo era, con las bandas, lo que más gritaba "juego original".
 */
export const STYLE = { outlines: false };

/**
 * Rampa suave: 64 téxeles con filtrado lineal y una S tendida. MeshToonMaterial la muestrea con el
 * half-lambert (n·l·0.5+0.5), así que el lado oscuro no cae a negro sino a ~30-40 %: la luz "envuelve" la
 * forma como en una figura de arcilla, y el color de la sombra lo pone la luz hemisférica del cielo.
 */
function smoothRamp(low: number, high: number, lift: number): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    // S suave centrada algo a la izquierda: más superficie en la parte iluminada que en la oscura.
    const t = Math.min(1, Math.max(0, (x - 0.18) / 0.7));
    const sm = t * t * (3 - 2 * t);
    const v = Math.round(255 * (low + (high - low) * (lift * x + (1 - lift) * sm)));
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let ramp: THREE.DataTexture | null = null;
/** La rampa de las piezas modeladas (coliseos, props, personajes): con algo más de contraste. */
export function toonRamp(): THREE.DataTexture {
  return (ramp ??= smoothRamp(0.3, 1, 0.2));
}

let softRamp: THREE.DataTexture | null = null;
/**
 * La rampa de la vegetación y las rocas: más tendida todavía. El follaje son cartas con normales muy
 * variadas, y cualquier contraste fuerte en la rampa lo convierte en ruido de claro/oscuro.
 */
export function toonRampSoft(): THREE.DataTexture {
  return (softRamp ??= smoothRamp(0.42, 1, 0.35));
}

/**
 * Gradación de los assets del pack hacia la paleta del coliseo. Sus texturas vienen muy saturadas (la hoja
 * de broadleaf promedia (126,205,0), sin nada de azul): a pleno sol y sin tone mapping se leían como
 * plástico brillante al lado de la piedra y la madera mate del coliseo. Se aplica en el shader, después de
 * muestrear la textura, porque un tinte multiplicativo no puede desaturar un canal que vale 0.
 */
export interface Grade { saturation: number; value: number; warm: number }
// Más saturación que antes (0.8): el tone mapping AgX del postproceso desatura los tonos altos, y con
// la gradación anterior los verdes del MegaKit llegaban a pantalla grises.
export const WORLD_GRADE: Grade = { saturation: 1.08, value: 1, warm: 0.6 };

export interface ToonOptions {
  rim?: number;
  rimColor?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  opacity?: number;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  alphaTest?: number;
  /**
   * Si el material participa del fade de oclusor (descartar lo que tapa al jugador). Por defecto sí, pero
   * el SUELO lo pone en false: el suelo está justo bajo el jugador, dentro del cono cámara→jugador, así que
   * cualquier umbral de altura es frágil (una versión previa lo dejaba dentro por 0.2 m y el suelo parpadeaba
   * dejando ver el cielo con cada paso). Excluirlo por completo, y no por un número mágico, es a prueba de
   * fallos: el suelo NUNCA se puede descartar.
   */
  occlude?: boolean;
  /** Saturación, valor y calidez (menos azul) aplicados al color base ya texturizado (1, 1, 0 = sin cambio). */
  grade?: Grade;
  soft?: boolean;
}

interface RimUniforms {
  rim: { value: number };
  rimColor: { value: THREE.Color };
  grade: { value: THREE.Vector3 };
}

/**
 * Material toon con luz de borde inyectada en el fragment shader. El fresnel se calcula contra
 * vViewPosition (que el shader de toon ya declara vía normal_pars_fragment) y se suma a outgoingLight
 * justo antes de opaque_fragment, igual que en el original.
 */
export function toonMaterial(
  color: THREE.ColorRepresentation,
  // rim en 0 por defecto: la luz de borde suma blanco según el ángulo de vista, así que "se mueve" con la
  // cámara — un candidato de parpadeo blanco que sobrevivía incluso con sombras/bloom/oclusor apagados.
  // Cero por ahora para aislar. Restaurar a ~0.12 una vez confirmado que no era esto.
  { rim = 0.16, rimColor = 0xffe2b8, emissive = 0x000000, opacity = 1, map = null, vertexColors = false, alphaTest = 0, occlude = true, grade, soft = false }: ToonOptions = {},
): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: soft ? toonRampSoft() : toonRamp(),
    emissive,
    transparent: opacity < 1,
    opacity,
    vertexColors,
  });
  if (map) m.map = map;
  if (alphaTest > 0) m.alphaTest = alphaTest;

  const uniforms: RimUniforms = {
    rim: { value: rim },
    rimColor: { value: new THREE.Color(rimColor) },
    grade: { value: new THREE.Vector3(grade?.saturation ?? 1, grade?.value ?? 1, grade?.warm ?? 0) },
  };
  m.userData.rimUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = uniforms.rim;
    shader.uniforms.uRimColor = uniforms.rimColor;
    shader.uniforms.uGrade = uniforms.grade;
    shader.uniforms.uOccB = occluder.uOccB;
    shader.uniforms.uOccOn = occluder.uOccOn;
    // Posición de mundo por fragmento, para medir la distancia al eje cámara→objetivo. Se calcula tras
    // project_vertex y respeta el instanceMatrix, así funciona igual en mallas sueltas e instanciadas.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOccW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 occW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        occW = instanceMatrix * occW;
        #endif
        vOccW = (modelMatrix * occW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;\nuniform vec3 uGrade;\nvarying vec3 vOccW;\nuniform vec3 uOccB;\nuniform float uOccOn;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uGrade.x) * uGrade.y
          * mix(vec3(1.0), vec3(1.04, 1.0, 0.86), uGrade.z);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `
        float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        rimF = smoothstep(0.45, 1.0, rimF);
        outgoingLight += uRimColor * rimF * uRim;
        #include <opaque_fragment>`,
      );
    if (occlude) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // Oclusor: desvanece SOLO lo que tapa al jugador y está por encima de su cabeza (troncos/copas).
        // El límite pasa a uOccB.y + 0.6 (uOccB es el pecho; +0.6 ≈ por encima de la cabeza): así la hierba
        // y los props bajos NUNCA entran. (El suelo ni siquiera compila esta rama: va con occlude:false.)
        if (uOccOn > 0.5 && vOccW.y > uOccB.y + 0.6) {
          vec3 ab = uOccB - cameraPosition; float L2 = max(dot(ab, ab), 1e-3), L = sqrt(L2);
          float t = dot(vOccW - cameraPosition, ab) / L2;
          if (t > 0.0 && t * L < L - 0.25) {
            float d = length(vOccW - (cameraPosition + ab * t));
            float r = mix(2.6, 1.2, t);
            float fade = 1.0 - smoothstep(r * 0.72, r, d);
            // Corte duro por DISTANCIA de mundo al eje cámara→jugador, no dither de pantalla. El dither
            // anterior (fract(floor(gl_FragCoord.xy)·…)) es un umbral por PÍXEL de pantalla: al mover la
            // cámara, cada fragmento del objeto cae en un píxel distinto cada frame, así que el patrón de
            // descarte "nadaba" y los agujeros parpadeaban dejando ver el cielo casi blanco del horizonte
            // — ese era el parpadeo blanco con cada movimiento. Un corte por 'fade' (distancia de mundo,
            // continua) mueve el borde suavemente con la cámara: sin parpadeo por frame.
            if (fade > 0.5) discard;
          }
        }`);
    }
  };
  m.customProgramCacheKey = () => (occlude ? 'toonrim-occ3' : 'toonrim-noocc');
  return m;
}

/**
 * Convierte un material que venía de un GLB (normalmente MeshStandardMaterial) a su equivalente toon,
 * conservando color base y textura y tirando todo lo que es PBR. `tint` multiplica el color base.
 *
 * rim baja de 0.3 a 0.15: el rim suma blanco puro sobre el color ya en la banda más clara de la rampa
 * toon, y con los verdes vivos del pack (p.ej. el nativo de broadleaf, ~(126,205,0)) esa suma ya cruzaba
 * luminancia 0.9 en cualquier silueta a ángulo rasante — como el rim depende del ángulo cámara↔superficie,
 * qué triángulos lo alcanzan cambia con cada giro de cámara, y encima del umbral de Bloom (ver Scene.tsx)
 * eso se leía como un centelleo blanco constante en el follaje con cualquier movimiento. Verificado con
 * los colores nativos reales del pack, no a ojo (script en /tmp/verify/check_luminance.cjs).
 */
export function toonFromMaterial(
  src: THREE.Material,
  { tint, rim = 0.04, grade = WORLD_GRADE, soft = true }: { tint?: THREE.Color; rim?: number; grade?: Grade; soft?: boolean } = {},
): THREE.MeshToonMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const color = std.color ? std.color.clone() : new THREE.Color(0xffffff);
  if (tint) color.multiply(tint);

  const m = toonMaterial(color, {
    rim,
    grade,
    soft,
    map: std.map ?? null,
    opacity: std.opacity ?? 1,
    // Las hojas de Quaternius vienen como planos con alpha en la textura; sin alphaTest se ven como
    // cuadrados opacos. transparent + depthWrite daría orden de dibujado roto en un InstancedMesh.
    alphaTest: std.alphaTest > 0 ? std.alphaTest : std.transparent ? 0.5 : 0,
  });
  m.side = std.side ?? THREE.FrontSide;
  m.name = std.name;
  return m;
}

/** Marrón oscuro cálido en vez del casi-negro azulado: con la madera y la tierra se lee como sombra, no como trazo. */
export const OUTLINE_COLOR = 0x2e261d;

/**
 * Material de contorno: una copia de la malla dibujada solo por las caras traseras y empujada hacia
 * fuera a lo largo de la normal. `width` está en unidades del espacio del objeto — quien lo llama
 * divide por la escala de la instancia para que el grosor se vea parejo.
 *
 * Solo para geometría sólida y cerrada. En una carta plana (las hojas de los packs de naturaleza)
 * desplazar por la normal no engorda nada: deja la copia oscura delante de la carta. Quien llama filtra
 * esas partes por su alphaTest.
 */
export function outlineMaterial(width: number, color: THREE.ColorRepresentation = OUTLINE_COLOR): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const uW = { value: width };
  m.userData.widthUniform = uW;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uW = uW;
    // El oclusor también aquí: si no, al desvanecerse el follaje/tronco toon quedaba flotando su casco
    // de contorno oscuro (el backside), que se leía como una mancha negra con forma de árbol. Comparte
    // los mismos uniforms que toonMaterial y calcula vOccW igual, respetando instanceMatrix.
    shader.uniforms.uOccB = occluder.uOccB;
    shader.uniforms.uOccOn = occluder.uOccOn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uW;\nvarying vec3 vOccW;')
      // MeshBasicMaterial no incluye beginnormal_vertex, así que objectNormal no existe: lo declaramos.
      .replace('#include <begin_vertex>', '#ifndef USE_SKINNING\n  vec3 objectNormal = vec3( normal );\n#endif\n#include <begin_vertex>')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  transformed += normalize( objectNormal ) * uW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 occW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        occW = instanceMatrix * occW;
        #endif
        vOccW = (modelMatrix * occW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOccW;\nuniform vec3 uOccB;\nuniform float uOccOn;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // Mismo gate y mismo corte suave por distancia de mundo que en toonMaterial — ver ahí el porqué
        // (evita el dither de pantalla que parpadeaba al mover la cámara).
        if (uOccOn > 0.5 && vOccW.y > uOccB.y + 0.6) {
          vec3 ab = uOccB - cameraPosition; float L2 = max(dot(ab, ab), 1e-3), L = sqrt(L2);
          float t = dot(vOccW - cameraPosition, ab) / L2;
          if (t > 0.0 && t * L < L - 0.25) {
            float d = length(vOccW - (cameraPosition + ab * t));
            float r = mix(2.6, 1.2, t);
            float fade = 1.0 - smoothstep(r * 0.72, r, d);
            if (fade > 0.5) discard;
          }
        }`);
  };
  m.customProgramCacheKey = () => 'outline-occ2';
  return m;
}

/**
 * Aplica toon + contorno a un árbol de objetos ya montado (personajes, monstruos, props sueltos).
 * Para InstancedMesh usar buildInstanced() en instancing.ts, que hace el contorno instanciado.
 *
 * rim baja de 0.32 a 0.16 — mismo motivo que en toonFromMaterial: evitar que el rim empuje colores ya
 * claros por encima del umbral de Bloom en cualquier ángulo rasante.
 */
export function toonifyObject(
  root: THREE.Object3D,
  { outline = 0.02, rim = 0.12, tint }: { outline?: number; rim?: number; tint?: (name: string, color: THREE.Color) => THREE.Color | null } = {},
): THREE.Object3D {
  root.updateMatrixWorld(true);
  const worldScale = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) && !mesh.userData.isOutline) meshes.push(mesh);
  });

  for (const mesh of meshes) {
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const converted = sources.map((mat) => {
      const name = mat.name || '';
      const std = mat as THREE.MeshStandardMaterial;
      let color = std.color ? std.color.clone() : new THREE.Color(0xffffff);
      if (tint) {
        const next = tint(name, color);
        if (next) color = next;
      }
      // Los ojos son el único sitio donde el look toon estorba: el blanco necesita quedar plano y la
      // pupila necesita el brillo especular que le da vida a la cara.
      if (/Eye_?White/i.test(name)) return toonMaterial(0xffffff, { rim: 0.1, emissive: 0x222222 });
      if (/Eye_?Black|Pupil/i.test(name)) return new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.08, metalness: 0.2 });
      const m = toonFromMaterial(mat, { rim, grade: { saturation: 1, value: 1, warm: 0 }, soft: false });
      m.color.copy(color);
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
    mesh.castShadow = true;

    const first = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshToonMaterial;
    // Igual que en instancing.ts: nada de contorno en cartas recortadas por alfa, el casco invertido solo
    // tiene sentido en geometría sólida.
    if (!STYLE.outlines || outline <= 0 || first.alphaTest > 0) continue;
    mesh.getWorldScale(worldScale);
    const meanScale = (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3;
    const width = outline / Math.max(1e-4, meanScale);
    const lineMaterial = outlineMaterial(width);
    const skinned = mesh as unknown as THREE.SkinnedMesh;
    let line: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const skinnedLine = new THREE.SkinnedMesh(mesh.geometry, lineMaterial);
      skinnedLine.bind(skinned.skeleton, skinned.bindMatrix);
      line = skinnedLine;
    } else {
      line = new THREE.Mesh(mesh.geometry, lineMaterial);
    }
    line.castShadow = false;
    line.userData.isOutline = true;
    // El contorno desplaza vértices en el shader, así que su bounding box real es mayor que la de la
    // geometría: sin esto three lo recorta antes de tiempo al borde de la pantalla.
    line.frustumCulled = false;
    mesh.frustumCulled = false;
    line.position.copy(mesh.position);
    line.quaternion.copy(mesh.quaternion);
    line.scale.copy(mesh.scale);
    mesh.parent?.add(line);
  }
  return root;
}
