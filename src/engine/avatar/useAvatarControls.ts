/**
 * useAvatarControls — teclado→movimiento sin re-renders por frame.
 * Portado de cowork-v3 sin cambios: patrón "ref-first para alta frecuencia, state solo para
 * transiciones visuales" (idle→walk, walk→run). La lógica de movimiento vive en useFrame vía refs.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import type { AnimationState } from './shared';

export interface AvatarControlsState {
  keysPressed: React.MutableRefObject<Set<string>>;
  isRunningRef: React.MutableRefObject<boolean>;
  directionRef: React.MutableRefObject<string>;
  isMovingRef: React.MutableRefObject<boolean>;
  animationStateRef: React.MutableRefObject<AnimationState>;
  animationState: AnimationState;
  direction: string;
  isRunning: boolean;
  updateMovement: (dx: number, dz: number, running?: boolean) => void;
  setAnimationState: React.Dispatch<React.SetStateAction<AnimationState>>;
  setDirection: React.Dispatch<React.SetStateAction<string>>;
}

/** Correr fijado con R: estado global para que el HUD lo muestre. */
export const runLock = { value: false };
const runLockSubs = new Set<() => void>();
export function setRunLock(v: boolean) { runLock.value = v; runLockSubs.forEach((f) => f()); }
export function useRunLock(): boolean {
  const [v, setV] = useState(runLock.value);
  useEffect(() => { const f = () => setV(runLock.value); runLockSubs.add(f); return () => { runLockSubs.delete(f); }; }, []);
  return v;
}

export const useAvatarControls = (): AvatarControlsState => {
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const [direction, setDirection] = useState<string>('front');
  const [isRunning, setIsRunning] = useState(false);

  const keysPressed = useRef<Set<string>>(new Set());
  const isRunningRef = useRef(false);
  const directionRef = useRef('front');
  const isMovingRef = useRef(false);
  const animationStateRef = useRef<AnimationState>('idle');

  useEffect(() => { animationStateRef.current = animationState; }, [animationState]);
  useEffect(() => { directionRef.current = direction; }, [direction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable
      );
      if (isTyping) return;

      keysPressed.current.add(e.code);

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        isRunningRef.current = true;
        setIsRunning(true);
      }
      // R alterna "correr siempre" (como las zapatillas de correr de la saga); Shift invierte mientras se mantiene.
      if (e.code === 'KeyR' && !e.repeat) setRunLock(!runLock.value);

      if (e.code === 'KeyE') { animationStateRef.current = 'cheer'; setAnimationState('cheer'); }
      if (e.code === 'KeyQ') { animationStateRef.current = 'dance'; setAnimationState('dance'); }

      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.code);

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        isRunningRef.current = false;
        setIsRunning(false);
      }

      if (['KeyE', 'KeyQ'].includes(e.code)) {
        animationStateRef.current = 'idle';
        setAnimationState('idle');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const updateMovement = useCallback((dx: number, dz: number, running = isRunningRef.current) => {
    const moving = dx !== 0 || dz !== 0;
    isMovingRef.current = moving;

    if (moving) {
      let newDirection: string;
      if (Math.abs(dx) > Math.abs(dz)) newDirection = dx > 0 ? 'right' : 'left';
      else newDirection = dz > 0 ? 'up' : 'front';

      if (directionRef.current !== newDirection) {
        directionRef.current = newDirection;
        setDirection(newDirection);
      }

      const nextAnim: AnimationState = running ? 'run' : 'walk';
      if (animationStateRef.current !== nextAnim) {
        animationStateRef.current = nextAnim;
        setAnimationState(nextAnim);
      }
    } else if (animationStateRef.current === 'walk' || animationStateRef.current === 'run') {
      animationStateRef.current = 'idle';
      setAnimationState('idle');
    }
  }, []);

  return {
    keysPressed, isRunningRef, directionRef, isMovingRef, animationStateRef,
    animationState, direction, isRunning, updateMovement, setAnimationState, setDirection,
  };
};
