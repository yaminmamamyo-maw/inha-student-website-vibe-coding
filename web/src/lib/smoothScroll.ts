import Lenis from 'lenis';
import { useEffect } from 'react';

let lenis: Lenis | null = null;

/** Eased page scrolling (gchf-style). Off for users who prefer reduced motion. */
export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 3), smoothWheel: true });
    let raf = requestAnimationFrame(function loop(time) {
      lenis?.raf(time);
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(raf);
      lenis?.destroy();
      lenis = null;
    };
  }, []);
}

/** Smoothly scroll to an element (falls back to native scrolling). */
export function scrollToTarget(target: string | HTMLElement, offset = 0) {
  if (lenis) lenis.scrollTo(target, { offset, duration: 1.2 });
  else (typeof target === 'string' ? document.querySelector(target) : target)?.scrollIntoView({ behavior: 'smooth' });
}

/** Jump to top on route change without animating across pages. */
export function resetScroll() {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else window.scrollTo(0, 0);
}
