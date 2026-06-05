import React, { useState, useEffect, useCallback } from 'react';
import { Maximize, Minimize, Smartphone, RotateCw, Play } from 'lucide-react';
import { sound } from '../utils/audio';

/**
 * Reads the current orientation. Prefers the Screen Orientation API,
 * falls back to a matchMedia query for older / desktop browsers.
 */
function readIsPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  const so = window.screen?.orientation?.type;
  if (so) return so.startsWith('portrait');
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(orientation: portrait)').matches;
  }
  return window.innerHeight >= window.innerWidth;
}

/**
 * Heuristic phone detection. We only want to nag phones (small touch screens)
 * to rotate — tablets and desktops are left alone.
 */
function detectIsPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaPhone = /iPhone|iPod|Windows Phone|BlackBerry|BB10|Opera Mini/i.test(ua) ||
    (/Android/i.test(ua) && /Mobile/i.test(ua));
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  // Smallest physical edge: phones are typically < ~600px on the short side.
  const shortEdge = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  const smallScreen = isTouch && shortEdge > 0 && shortEdge <= 600;
  return uaPhone || smallScreen;
}

interface MobileShellProps {
  /** Right offset (in tailwind spacing units) so the button can sit next to other top-right controls. */
  buttonRightClass?: string;
}

export default function MobileShell({ buttonRightClass = 'right-16' }: MobileShellProps) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isPhone] = useState<boolean>(() => detectIsPhone());
  const [isPortrait, setIsPortrait] = useState<boolean>(() => readIsPortrait());
  // Once the player has gone through the rotate gate (or already started in landscape),
  // we never show the prompt again for this session.
  const [gatePassed, setGatePassed] = useState<boolean>(() => isPhone ? !readIsPortrait() : true);

  // Track fullscreen state from the document so our icon stays in sync
  // even if the user exits via the system back gesture / ESC.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Watch orientation. Once the device reaches landscape we mark the gate as
  // passed and never force it back to portrait.
  useEffect(() => {
    const update = () => {
      const portrait = readIsPortrait();
      setIsPortrait(portrait);
      if (!portrait) setGatePassed(true);
    };
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    const mq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(orientation: portrait)')
      : null;
    mq?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch {
      /* user agent may reject — non-fatal */
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    sound.playClick();
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* ignore */ }
    } else {
      await enterFullscreen();
    }
  }, [enterFullscreen]);

  // "Start" from the rotate overlay: go fullscreen, then force landscape.
  // Locking to 'landscape' overrides a disabled auto-rotate, and because we
  // never lock to portrait the device stays horizontal afterwards.
  const handleStartLandscape = useCallback(async () => {
    sound.playClick();
    await enterFullscreen();
    const orientation = window.screen?.orientation as (ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    }) | undefined;
    try {
      await orientation?.lock?.('landscape');
    } catch {
      /* lock unsupported (e.g. iOS) — the visual hint still nudges the user */
    }
    setGatePassed(true);
  }, [enterFullscreen]);

  const showRotateGate = isPhone && isPortrait && !gatePassed;

  return (
    <>
      {/* Fullscreen toggle — sits beside the audio control */}
      <div className={`fixed top-4 ${buttonRightClass} z-50`}>
        <button
          onClick={toggleFullscreen}
          className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg backdrop-blur-md cursor-pointer transition shadow-lg"
          title={isFullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
        >
          {isFullscreen
            ? <Minimize className="w-4 h-4" />
            : <Maximize className="w-4 h-4 text-cyan-400" />}
        </button>
      </div>

      {/* Rotate-to-landscape gate (phones in portrait only) */}
      {showRotateGate && (
        <div className="fixed inset-0 z-[100] bg-[#070b0e] flex flex-col items-center justify-center gap-8 px-8 text-center select-none">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-950/30 via-slate-950/80 to-[#070b0e] pointer-events-none" />

          <div className="relative flex flex-col items-center gap-6">
            <div className="relative">
              <Smartphone className="w-20 h-20 text-cyan-400 animate-rotate-device" strokeWidth={1.5} />
              <RotateCw className="w-7 h-7 text-cyan-300 absolute -top-2 -right-6 animate-spin" style={{ animationDuration: '2.4s' }} />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black uppercase tracking-widest text-cyan-300">
                Поверните устройство
              </h2>
              <p className="text-sm text-slate-300 font-mono max-w-xs leading-relaxed">
                Игра рассчитана на горизонтальный режим. Переверните телефон в&nbsp;ландшафтную ориентацию.
              </p>
            </div>
          </div>

          <button
            onClick={handleStartLandscape}
            className="relative flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-[#070b0e] font-black uppercase tracking-widest py-3.5 px-8 rounded-lg shadow-xl transition cursor-pointer active:scale-95"
          >
            <Play className="w-4 h-4 fill-current" />
            Начать
          </button>

          <p className="relative text-[11px] text-slate-500 font-mono">
            Кнопка развернёт экран автоматически
          </p>
        </div>
      )}
    </>
  );
}
