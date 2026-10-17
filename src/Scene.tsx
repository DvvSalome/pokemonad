import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Vignette, HueSaturation } from '@react-three/postprocessing';
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
import { Sky } from './world/Sky';
import { BattleArena } from './world/BattleArena';
import { Colosseum } from './world/Colosseum';
import { inArena } from './world/battleStore';
import { ARENA } from './world/terrain';
import { TitleCamera, PEDESTAL, type TitleMode } from './world/TitleCamera';
import { Pedestal } from './world/Pedestal';
import { DayNightCycle } from './engine/scene/DayNightCycle';
import { ParticulasClima } from './engine/scene/ParticulasClima';
import { MobileJoystick, type JoystickInput } from './engine/scene/MobileJoystick';
import type { Posicion3DPlano } from './engine/runtime/movimiento';
import type { RosterEntry } from './engine/avatar/characterRoster';
import { isMobileDevice } from '../lib/mobileDetect';
import * as wild from './world/wildStore';
import * as buffs from './world/buffs';
import * as capture from './world/captureStore';
import * as battle from './world/battleStore';

// El jugador arranca donde estaba de pie en el pedestal de la pantalla de selección.
const START: Posicion3DPlano = { x: PEDESTAL.x, z: PEDESTAL.z };
// Color de arranque, antes de que DayNightCycle escriba el primero de verdad (ver world/lighting.ts).
const SKY_START = new THREE.Color(0xc3e7ff);

export type SceneMode = TitleMode | 'play';

interface SceneProps { mode: SceneMode; characterConfig?: RosterEntry | null }

export const Scene: React.FC<SceneProps> = ({ mode, characterConfig }) => {
  const playing = mode === 'play';
  const posRef = useRef<Posicion3DPlano>({ ...START });
  const joystickRef = useRef<JoystickInput>({ dx: 0, dz: 0, magnitude: 0, isRunning: false, active: false });
  const [showJoystick, setShowJoystick] = useState(false);

  // Lo que siguen la sombra y el clima: el jugador, salvo en combate, que es el estadio (puede estar a
  // más de los ±60 m que cubre la cámara de sombras del sitio del encuentro).
  const focusRef = useMemo(() => ({
    get current(): Posicion3DPlano { return inArena() ? ARENA : posRef.current; },
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
          if (import.meta.env.DEV) (window as unknown as { __pg: unknown }).__pg = { scene, camera, gl, advance, wild, buffs, capture, battle };
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
        <Colosseum />
        {playing ? (
          <>
            <BattleArena />
            <CaptureBall />
            <CaptureController targetRef={posRef} />
            <Player start={START} posRef={posRef} joystickRef={joystickRef} characterConfig={characterConfig ?? undefined} />
            <CameraRig targetRef={posRef} ease />
            <CameraInput />
          </>
        ) : (
          <>
            <TitleCamera mode={mode} focusRef={posRef} />
            {mode === 'select' && characterConfig && <Pedestal character={characterConfig} />}
          </>
        )}
        <ParticulasClima centroRef={focusRef} />
        {/* Bloom QUITADO: era la causa del parpadeo blanco. Medido — renderizando por el EffectComposer
            aparecían frames enteros en blanco (100%) de forma intermitente durante el movimiento; con
            render directo (sin composer) nunca. El Bloom con mipmapBlur ocasionalmente reventaba toda la
            pantalla a blanco. HueSaturation + Vignette se quedan: son transformaciones de color por píxel,
            deterministas, no pueden producir un frame blanco. */}
        <EffectComposer>
          <HueSaturation saturation={0.04} hue={0} />
          <Vignette eskil={false} offset={0.22} darkness={0.28} />
        </EffectComposer>
      </Canvas>
      {showJoystick && playing && <MobileJoystick inputRef={joystickRef} />}
    </div>
  );
};
