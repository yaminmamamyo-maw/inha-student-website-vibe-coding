import { useEffect, useRef } from 'react';
import './HeroParticles.css';

// Particle-network background for the home hero, ported from the "Aether Flow" hero (canvas part only;
// its text/button/framer-motion parts are not used). Differences from the original:
// - sized to its parent (the hero), not the window, so the effect ends where the hero ends
// - transparent: the theme's hero background shows through (no black fill)
// - colours come from the active theme's tokens (--accent for dots/lines, --ink near the pointer)
// - pauses when off-screen or the tab is hidden; one static frame with prefers-reduced-motion
// - capped particle count and devicePixelRatio for low-end devices; no allocations in the frame loop

const AREA_PER_PARTICLE = 9000;
const MAX_PARTICLES = 140;
const POINTER_RADIUS = 160;
const LINK_DISTANCE = 120; // px; lines fade out towards this distance

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export function HeroParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0, y: 0, active: false };
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let dot = '#000';
    let near = '#000';

    const readColors = () => {
      const css = getComputedStyle(document.documentElement);
      dot = css.getPropertyValue('--accent').trim() || '#000';
      near = css.getPropertyValue('--ink').trim() || '#000';
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(MAX_PARTICLES, Math.round((width * height) / AREA_PER_PARTICLE));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.random() * 0.4 - 0.2,
        vy: Math.random() * 0.4 - 0.2,
        r: Math.random() * 2 + 1,
      }));
      readColors();
      draw();
    };

    const step = () => {
      for (const p of particles) {
        if (p.x > width || p.x < 0) p.vx = -p.vx;
        if (p.y > height || p.y < 0) p.vy = -p.vy;
        if (pointer.active) {
          // gently push particles away from the pointer
          const dx = pointer.x - p.x;
          const dy = pointer.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < POINTER_RADIUS + p.r) {
            const force = (POINTER_RADIUS - dist) / POINTER_RADIUS;
            p.x -= (dx / dist) * force * 3;
            p.y -= (dy / dist) * force * 3;
          }
        }
        p.x += p.vx;
        p.y += p.vy;
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      for (let a = 0; a < particles.length; a++) {
        const pa = particles[a];
        for (let b = a + 1; b < particles.length; b++) {
          const pb = particles[b];
          const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (dist >= LINK_DISTANCE) continue;
          const nearPointer = pointer.active && Math.hypot(pa.x - pointer.x, pa.y - pointer.y) < POINTER_RADIUS;
          ctx.strokeStyle = nearPointer ? near : dot;
          ctx.globalAlpha = (1 - dist / LINK_DISTANCE) * (nearPointer ? 0.55 : 0.28);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = dot;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      step();
      draw();
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!reducedMotion && !frame && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    // the canvas ignores pointer events (content stays clickable), so track the pointer on the window
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    intersection.observe(host);
    if (!reducedMotion) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('pointerleave', onPointerLeave);
    }
    document.addEventListener('visibilitychange', onVisibility);

    resize();
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-particles" aria-hidden />;
}
