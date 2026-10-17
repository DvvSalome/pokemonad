// Niebla atmosférica: extiende la niebla lineal de three con bruma baja (se acumula en valles y sobre el
// agua, deja limpias las cumbres) y con un tinte cálido hacia el sol (perspectiva aérea). Se parchea el
// chunk global, así que lo reciben todos los materiales con fog sin tocar cada uno.
//
// Los uniforms extra van en ShaderLib como objetos PLANOS ({x,y,z}), no Vector3: UniformsUtils.clone
// copia los Vector3/Color por material, y un objeto plano se comparte por referencia — así un solo
// write por frame llega a todos los programas. El setter de three acepta objetos con .x/.y/.z.
import * as THREE from 'three';

export const atmoUniforms = {
  atmoSunDir: { value: { x: 0.6, y: 0.6, z: 0.5 } },
  atmoGlow: { value: { x: 0, y: 0, z: 0 } },
  /** Cenit del cielo: la niebla toma el color de la cúpula en la elevación a la que se mira. */
  atmoTop: { value: { x: 0.25, y: 0.5, z: 0.86 } },
  /** x: altura base de la bruma, y: caída con la altura, z: opacidad máxima. */
  atmoHaze: { value: { x: 0.4, y: 0.22, z: 0.3 } },
};

// La posición de mundo sale de mvPosition con la inversa de viewMatrix (rotación transpuesta): vale para
// cualquier material con fog, incluidos sprites e instancias, que no comparten nombre de variable.
THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;
THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  uniform vec3 atmoSunDir;
  uniform vec3 atmoGlow;
  uniform vec3 atmoTop;
  uniform vec3 atmoHaze;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 atmoRay = vFogWorld - cameraPosition;
  float atmoDist = length( atmoRay );
  vec3 atmoDir = atmoRay / max( atmoDist, 1e-3 );
  float atmoLow = exp( - max( vFogWorld.y - atmoHaze.x, 0.0 ) * atmoHaze.y );
  float atmoH = atmoHaze.z * atmoLow * ( 1.0 - exp( - atmoDist * 0.014 ) );
  fogFactor = clamp( fogFactor + atmoH * ( 1.0 - fogFactor ), 0.0, 1.0 );
  // Mismo degradado y resplandor que Sky.tsx: lo que se funde en la niebla se funde en el cielo que tiene
  // detrás, también en las laderas altas que tapan media cúpula.
  float atmoUp = max( atmoDir.y, 0.0 );
  float atmoHor = 1.0 - smoothstep( 0.0, 0.55, atmoUp );
  float atmoSd = max( dot( atmoDir, atmoSunDir ), 0.0 );
  vec3 atmoCol = mix( fogColor, atmoTop, sqrt( atmoUp ) );
  // Perspectiva aérea: a media distancia se tiñe hacia el azul del cenit y solo al final alcanza el color
  // del cielo; así las capas lejanas se separan en azules en vez de lavarse todas a blanco.
  atmoCol = mix( mix( atmoTop, fogColor, 0.5 ), atmoCol, smoothstep( 0.35, 1.0, fogFactor ) );
  atmoCol += atmoGlow * ( pow( atmoSd, 6.0 ) * mix( 0.35, 1.0, atmoHor ) + atmoSd * atmoSd * 0.18 * atmoHor );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, atmoCol, fogFactor );
#endif
`;

const libs = THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, unknown> }>;
for (const k of Object.keys(libs)) Object.assign(libs[k].uniforms, atmoUniforms);
Object.assign(THREE.UniformsLib.fog, atmoUniforms);
