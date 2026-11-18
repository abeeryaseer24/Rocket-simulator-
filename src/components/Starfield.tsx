import { useEffect, useRef } from 'react';

interface Props {
  /** 0 = invisible (daylight), 1 = full night sky */
  visibility: number;
  /** Vertical drift in px applied to the nearest layer (parallax with scroll / climb) */
  drift?: number;
  /** Occasional meteors */
  meteors?: boolean;
  className?: string;
}

interface Star {
  x: number;
  y: number;
  r: number;
  depth: number;
  phase: number;
  speed: number;
  tint: number;
}

/**
 * Canvas starfield: three depth layers with parallax, scintillation that
 * fades as the air thins (stars stop twinkling above the atmosphere), and
 * the odd meteor. Honours prefers-reduced-motion.
 */
export default function Starfield({ visibility, drift = 0, meteors = true, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vis = useRef(visibility);
  const dr = useRef(drift);
  vis.current = visibility;
  dr.current = drift;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stars: Star[] = [];
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const build = () => {
      w = c.clientWidth;
      h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      const n = Math.round((w * h) / 2600);
      stars = Array.from({ length: n }, () => {
        const depth = Math.random();
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.35 + depth * depth * 1.5,
          depth,
          phase: Math.random() * Math.PI * 2,
          speed: 0.6 + Math.random() * 2.2,
          tint: Math.random(),
        };
      });
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(c);

    let meteor: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const v = vis.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (v <= 0.01) return;
      const t = now / 1000;
      // Scintillation is caused by atmospheric turbulence: strong when the sky is bright-ish, gone in vacuum
      const twinkle = reduce ? 0 : Math.min(1, (1 - v) * 2.4 + 0.15);
      for (const s of stars) {
        const y = (((s.y + dr.current * (0.15 + s.depth * 0.85)) % h) + h) % h;
        const a = v * (0.35 + 0.65 * s.depth) * (1 - twinkle * 0.5 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase)));
        ctx.fillStyle = s.tint > 0.85 ? `rgba(255,214,170,${a})` : s.tint < 0.12 ? `rgba(180,205,255,${a})` : `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (meteors && !reduce && v > 0.6) {
        if (!meteor && Math.random() < 0.004) {
          meteor = { x: Math.random() * w * 0.8 + w * 0.1, y: Math.random() * h * 0.4, vx: -(280 + Math.random() * 260), vy: 160 + Math.random() * 120, life: 1 };
        }
        if (meteor) {
          const m = meteor;
          m.x += m.vx / 60;
          m.y += m.vy / 60;
          m.life -= 1 / 50;
          const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.18, m.y - m.vy * 0.18);
          g.addColorStop(0, `rgba(255,255,255,${0.9 * m.life * v})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x - m.vx * 0.18, m.y - m.vy * 0.18);
          ctx.stroke();
          if (m.life <= 0) meteor = null;
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [meteors]);

  return <canvas ref={ref} className={className} aria-hidden style={{ width: '100%', height: '100%', display: 'block' }} />;
}
