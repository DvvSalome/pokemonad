/**
 * Utilidades de detección mobile y touch para adaptar la UI
 * entre experiencia desktop (teclado+mouse) y mobile (touch+joystick).
 * Portado de cowork-v3 sin cambios — es un helper genérico, no atado a oficina.
 */

export const isTouchDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

export const isSmallScreen = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
};

export const isMobileDevice = (): boolean => {
  return isTouchDevice() && isSmallScreen();
};

export const isTabletDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isTouchDevice() && window.innerWidth >= 768 && window.innerWidth < 1024;
};

/** Haptic feedback sutil — respetar preferencias del usuario */
export const hapticFeedback = (pattern: 'light' | 'medium' | 'heavy' = 'light') => {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  switch (pattern) {
    case 'light': navigator.vibrate(10); break;
    case 'medium': navigator.vibrate(25); break;
    case 'heavy': navigator.vibrate([15, 10, 15]); break;
  }
};
