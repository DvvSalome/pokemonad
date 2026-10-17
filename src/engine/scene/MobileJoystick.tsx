// Joystick virtual táctil con dead zone y feedback háptico. Portado de cowork-v3, cambiando las clases
// de Tailwind (no está configurado en este proyecto) por estilos inline equivalentes.
import React, { useRef, useCallback, useState, useEffect } from 'react';
import { hapticFeedback } from '@/lib/mobileDetect';

export interface JoystickInput {
  dx: number;
  dz: number;
  magnitude: number;
  isRunning: boolean;
  active: boolean;
}

interface MobileJoystickProps {
  inputRef: React.MutableRefObject<JoystickInput>;
  size?: number;
  deadZone?: number;
  runThreshold?: number;
}

const JOYSTICK_DEFAULT: JoystickInput = { dx: 0, dz: 0, magnitude: 0, isRunning: false, active: false };

export const MobileJoystick: React.FC<MobileJoystickProps> = ({ inputRef, size = 120, deadZone = 0.15, runThreshold = 0.7 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const touchIdRef = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const wasRunningRef = useRef(false);
  const maxDistance = size / 2;

  const resetJoystick = useCallback(() => {
    setKnobPos({ x: 0, y: 0 });
    setIsActive(false);
    touchIdRef.current = null;
    inputRef.current = { ...JOYSTICK_DEFAULT };
    wasRunningRef.current = false;
  }, [inputRef]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (touchIdRef.current !== null) return;

    const touch = e.changedTouches[0];
    touchIdRef.current = touch.identifier;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setIsActive(true);
    hapticFeedback('light');
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (touchIdRef.current === null) return;

    const touch = Array.from(e.changedTouches).find((t) => t.identifier === touchIdRef.current);
    if (!touch) return;

    const deltaX = touch.clientX - centerRef.current.x;
    const deltaY = touch.clientY - centerRef.current.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    const clampedDist = Math.min(distance, maxDistance);
    const angle = Math.atan2(deltaY, deltaX);
    const clampedX = Math.cos(angle) * clampedDist;
    const clampedY = Math.sin(angle) * clampedDist;

    setKnobPos({ x: clampedX, y: clampedY });

    const normalizedMag = clampedDist / maxDistance;
    const isInDeadZone = normalizedMag < deadZone;

    if (isInDeadZone) {
      inputRef.current = { dx: 0, dz: 0, magnitude: 0, isRunning: false, active: true };
    } else {
      const effectiveMag = (normalizedMag - deadZone) / (1 - deadZone);
      const dx = clampedX / maxDistance;
      const dz = -(clampedY / maxDistance);
      const isRunning = effectiveMag > runThreshold;
      inputRef.current = { dx, dz, magnitude: effectiveMag, isRunning, active: true };

      if (isRunning && !wasRunningRef.current) hapticFeedback('medium');
      wasRunningRef.current = isRunning;
    }
  }, [maxDistance, deadZone, runThreshold, inputRef]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const touch = Array.from(e.changedTouches).find((t) => t.identifier === touchIdRef.current);
    if (!touch) return;
    resetJoystick();
  }, [resetJoystick]);

  useEffect(() => () => { inputRef.current = { ...JOYSTICK_DEFAULT }; }, [inputRef]);

  const halfSize = size / 2;
  const knobSize = size * 0.4;
  const halfKnob = knobSize / 2;
  const ringOpacity = isActive ? 0.5 : 0.25;
  const knobOpacity = isActive ? 0.7 : 0.35;
  const magnitude = inputRef.current.magnitude;
  const isRunVisual = magnitude > runThreshold;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', zIndex: 150, userSelect: 'none', touchAction: 'none',
        bottom: 100, left: 20, width: size, height: size,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        style={{
          position: 'absolute', borderRadius: '50%', width: size, height: size, top: 0, left: 0,
          border: `2px solid rgba(99, 102, 241, ${ringOpacity})`,
          backgroundColor: `rgba(15, 23, 42, ${ringOpacity * 0.6})`,
          backdropFilter: 'blur(4px)',
          boxShadow: isRunVisual
            ? '0 0 20px rgba(99, 102, 241, 0.4), inset 0 0 15px rgba(99, 102, 241, 0.1)'
            : 'inset 0 0 10px rgba(0,0,0,0.3)',
          transition: 'opacity 150ms',
        }}
      />
      <div
        style={{
          position: 'absolute', borderRadius: '50%', width: knobSize, height: knobSize,
          left: halfSize - halfKnob + knobPos.x, top: halfSize - halfKnob + knobPos.y,
          backgroundColor: isRunVisual ? `rgba(129, 140, 248, ${knobOpacity + 0.15})` : `rgba(99, 102, 241, ${knobOpacity})`,
          border: '2px solid rgba(165, 180, 252, 0.5)',
          boxShadow: isRunVisual ? '0 0 12px rgba(129, 140, 248, 0.6)' : '0 2px 8px rgba(0,0,0,0.4)',
          transition: 'width 75ms, height 75ms, box-shadow 75ms',
        }}
      />
      {isActive && isRunVisual && (
        <div
          style={{
            position: 'absolute', bottom: -16, left: '50%', transform: 'translateX(-50%)',
            fontSize: 9, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.08em',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)', pointerEvents: 'none',
          }}
        >
          RUN
        </div>
      )}
    </div>
  );
};
