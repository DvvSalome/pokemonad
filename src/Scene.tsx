import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  EffectComposer, Vignette, HueSaturation, BrightnessContrast, N8AO, Bloom, TiltShift2, ToneMapping, SMAA,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { Ground } from './world/Ground';
import { Player } from './world/Player';
import { CameraRig } from './world/CameraRig';
import { CameraInput } from './world/CameraInput';
import { Trees } from './world/Trees';
import { Rocks } from './world/Rocks';
import { GrassTufts } from './world/GrassTufts';
import { Water } from './world/Water';
import { GroundCover } from './world/GroundCover';
import { Decor } from './world/Decor';
import { Wildlife } from './world/Wildlife';
import { LivingWorld } from './world/life/LivingWorld';
import { Monsters } from './world/Monsters';
import { OtherPlayers } from './world/OtherPlayers';
import { CaptureBall } from './world/CaptureBall';
import { CaptureController } from './world/CaptureController';
import { Fountains } from './world/Fountain';
import { Park } from './world/Park';
import { Landmarks } from './world/Landmarks';
import { Shore } from './world/Shore';
import { AcademyArena } from './world/AcademyArena';
import { Sky } from './world/Sky';
import { BattleArena } from './world/BattleArena';
import { Colosseum } from './world/Colosseum';
import { inArena } from './world/battleStore';
import { ACADEMY } from './world/academyStage';
import { ARENA } from './world/terrain';
import { TitleCamera, PEDESTAL, type TitleMode } from './world/TitleCamera';
import { Pedestal } from './world/Pedestal';
import { DayNightCycle } from './engine/scene/DayNightCycle';
import { ParticulasClima } from './engine/scene/ParticulasClima';
import { MobileJoystick, type JoystickInput } from './engine/scene/MobileJoystick';
import type { Posicion3DPlano } from './engine/runtime/movimiento';
import type { RosterEntry } from './engine/avatar/characterRoster';
import { isMobileDevice } from '../lib/mobileDetect';
import { orbit } from './world/cameraStore';
import * as wild from './world/wildStore';
import * as buffs from './world/buffs';
import * as capture from './world/captureStore';
import * as battle from './world/battleStore';

// El jugador arranca donde estaba de pie en el pedestal de la pantalla de selección.
const START: Posicion3DPlano = { x: PEDESTAL.x, z: PEDESTAL.z };
// Color de arranque, antes de que DayNightCycle escriba el primero de verdad (ver world/lighting.ts).
const SKY_START = new THREE.Color(0xa9e6d8);

export type SceneMode = TitleMode | 'play';

interface SceneProps {
  mode: SceneMode;
  characterConfig?: RosterEntry | null;
  /**
   * Modo exploración: el mundo entero y el jugador, sin captura ni combate. Es el modo del recorrido
   * libre por la región — se entra directo y lo único que se hace es caminar y encontrar los coliseos.
   */
  explore?: boolean;
}

export const Scene: React.FC<SceneProps> = ({ mode, characterConfig, explore = false }) => {
  const playing = mode === 'play';
  const posRef = useRef<Posicion3DPlano>({ ...START });
  const joystickRef = useRef<JoystickInput>({ dx: 0, dz: 0, magnitude: 0, isRunning: false, active: false });
  const [showJoystick, setShowJoystick] = useState(false);

  // Lo que siguen la sombra y el clima: el jugador, salvo en combate, que es el estadio (puede estar a
  // más de los ±60 m que cubre la cámara de sombras del sitio del encuentro).
  const focusRef = useMemo(() => ({
    get current(): Posicion3DPlano { return inArena() ? ARENA : ACADEMY.active ? ACADEMY.center : posRef.current; },
    set current(v: Posicion3DPlano) { posRef.current = v; },
  }), []);

  useEffect(() => { setShowJoystick(isMobileDevice()); }, []);
  useEffect(() => { if (playing) posRef.current = { ...START }; }, [playing]);

  // Contenedor con capa de composición propia y aislada + fondo oscuro: si el compositor se salta el
  // canvas un frame, debajo hay un color oscuro (parpadeo imperceptible) en vez del celeste casi blanco
  // que se veía como destello. Ver el comentario largo en index.css.
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#16241d', isolation: 'isolate', contain: 'paint' }}>
      <Canvas
        style={{ width: '100%', height: '100%' }}
        shadows
        // FOV 38 como el original: un poco teleobjetivo, que es parte de cómo se ve PokeGrass.
        camera={{ fov: 38, near: 0.5, far: 560 }}
        // Sin tone mapping a propósito. ACESFilmic está pensado para render fotorrealista: desatura y
        // apaga los tonos altos, que es justo lo que mata un estilo cel-shaded — los colores planos y
        // saturados del pack llegaban a pantalla lavados. Sin curva, el color que sale es el que el
        // artista pintó, y el contraste lo controlamos con la intensidad de las luces.
        //
        // alpha:false — canvas OPACO: la escena llena la pantalla, no necesita transparencia, y opaco es
        // la config de composición más estable (el navegador no tiene que mezclar el canvas con el DOM cada
        // frame). powerPreference alta: en portátiles con GPU doble evita glitches por cambio de GPU.
        gl={{ toneMapping: THREE.NoToneMapping, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ scene, gl, camera, advance }) => {
          // La niebla arranca lejos y cierra antes que el plano lejano, para que la región se disuelva en
          // el cielo. Sky.tsx le va actualizando el color con la hora.
          scene.fog = new THREE.Fog(SKY_START.getHex(), 110, 340);
          gl.setClearColor(SKY_START);
          // Solo en desarrollo: la escena de R3F vive en otro reconciliador y no se alcanza desde el DOM.
          // En desarrollo, un asa para inspeccionar y recorrer el mundo desde la consola: además de la
          // escena, la cámara orbital (para encuadrar un sitio) y el teletransporte (para ir a verlo).
          if (import.meta.env.DEV) (window as unknown as { __pg: unknown }).__pg = { scene, camera, gl, advance, wild, buffs, capture, battle, orbit, warpTo: wild.warpTo };
        }}
      >
        <Sky />
        {/* Sombras SÍ (medidas sin parpadeo: la cámara de sombras encaja en la rejilla de texeles y el
            normalBias evita el acne). El OCLUSOR queda fuera a propósito: medí que revela el fondo claro por
            sus agujeros al mover la cámara — era una de las dos fuentes del parpadeo blanco. La otra eran
            los paneles con backdrop-filter, ya reemplazados por sólidos. */}
        <DayNightCycle targetRef={focusRef} castShadow />
        <Ground />
        <Trees />
        <Rocks />
        <GrassTufts />
        <GroundCover />
        <Decor />
        <Wildlife />
        <LivingWorld playerRef={posRef} />
        <Monsters />
        <OtherPlayers />
        <Water />
        <Fountains />
        <Park />
        <Landmarks />
        <Shore />
        <AcademyArena />
        <Colosseum />
        {playing ? (
          <>
            {!explore && <BattleArena />}
            <CaptureBall quiet={explore} />
            <CaptureController targetRef={posRef} />
            <Player start={START} posRef={posRef} joystickRef={joystickRef} characterConfig={characterConfig ?? undefined} />
            {/* El barrido de entrada (`ease`) arranca desde la pose de la pantalla de selección; en el
                modo exploración no hay tal pantalla, así que la cámara se coloca ya detrás del jugador. */}
            <CameraRig targetRef={posRef} ease={!explore} />
            <CameraInput />
          </>
        ) : (
          <>
            <TitleCamera mode={mode} focusRef={posRef} />
            {mode === 'select' && characterConfig && <Pedestal character={characterConfig} />}
          </>
        )}
        <ParticulasClima centroRef={focusRef} />
        {/* El look del mundo se decide aquí, no en los materiales. Dirección de arte "diorama de arcilla":
              · N8AO: oclusión ambiental en pantalla. Es lo que más profundidad da — cada roca, árbol y
                monstruo se asienta en el suelo con su sombra de contacto, y las esquinas se oscurecen. Va
                teñida de violeta noche, no de negro, para que la sombra tenga color.
              · Bloom suave y alto (umbral 0.9, sin mipmapBlur): solo brillan el sol, las antorchas, el
                neón y los fuegos fatuos. El parpadeo blanco que se midió hace tiempo venía de la variante
                con mipmapBlur sobre el rim blanco puro; el rim ahora es cálido y tenue.
              · TiltShift2: desenfoca la franja de arriba y la de abajo. Es el efecto "maqueta en miniatura"
                y lo que más separa este mundo de un juego de monstruos portátil.
              · ACES: tone mapping de cine, que comprime los altos sin quemarlos y da el contraste de
                película. Se probó AgX y dejaba el mundo lechoso: con estas luces pedía demasiado contraste
                de vuelta. Detrás, saturación y contraste extra, que ACES también se come un poco.
            El orden importa: la AO va sobre la escena lineal, el desenfoque antes del tone mapping, el
            antialias al final. */}
        {/* En móvil la AO baja a su calidad más barata y el tilt-shift se quita: medido en escritorio, la
            cadena completa cuesta ~14.5 ms por frame, y en una GPU de teléfono eso no cabe en 60 fps. */}
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={2.6} distanceFalloff={1.2} intensity={2.6} quality={showJoystick ? 'performance' : 'medium'} color="#1c0a2e" halfRes />
          <Bloom intensity={0.38} luminanceThreshold={0.88} luminanceSmoothing={0.25} />
          <TiltShift2 blur={showJoystick ? 0 : 0.07} taper={0.7} samples={showJoystick ? 2 : 8} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <HueSaturation saturation={0.28} hue={0} />
          <BrightnessContrast brightness={0.02} contrast={0.16} />
          <Vignette eskil={false} offset={0.3} darkness={0.5} />
          <SMAA />
        </EffectComposer>
      </Canvas>
      {showJoystick && playing && <MobileJoystick inputRef={joystickRef} />}
    </div>
  );
};
