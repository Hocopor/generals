import { useEffect, useState } from 'react';

/**
 * Shared "is this a small / touch device" detector for the whole app.
 * A device counts as mobile when it exposes touch input OR the viewport is
 * narrow (<= 1024px). This intentionally also covers tablets and small laptops
 * so they get the dedicated mobile UI instead of the cramped desktop layout.
 *
 * Re-evaluates on resize / orientation change so the layout follows the device.
 */
export function detectIsMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const isSmall = window.innerWidth <= 1024;
  return isTouch || isSmall;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => detectIsMobile());

  useEffect(() => {
    const update = () => setIsMobile(detectIsMobile());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return isMobile;
}
