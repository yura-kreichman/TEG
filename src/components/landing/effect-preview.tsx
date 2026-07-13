"use client";

import { useEffect, useRef } from "react";

// Живое превью эффекта в чипе кабинета (docs/spec/08-landing.md, Шаг 6:
// "чипы с живым превью"). НЕ переиспользует public/landing-effects.js —
// тот написан под другой бюджет (ванильный JS, полноэкранный canvas,
// динамическая загрузка на публичной странице); здесь кабинет уже несёт
// полный React-бандл, отдельный маленький превью-движок в 64×40 canvas не
// задевает никакой бюджет. Формы частиц и физика — уменьшенная копия того
// же per-mode рисования, что в public/landing-effects.js (не просто цветные
// кружки — иначе Снег/Листопад/Искорки неотличимы друг от друга, ровно то,
// на что указал пользователь 2026-07-13).
const PARTICLE_COUNT = 8;

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  alpha: number;
  color: string;
  phase: number;
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function spawn(mode: string, W: number, H: number): Particle[] {
  const leaves = ["#C97B2D", "#B3541E", "#D9A036"];
  const petals = ["#F5A8C0", "#EF8BAE", "#FBD1DE"];
  const confetti = ["#0F6E56", "#2E6BE6", "#E8478B"];
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const p: Particle = {
      x: rand(0, W),
      y: rand(0, H),
      r: 2,
      vx: 0,
      vy: 0,
      rot: rand(0, 6.28),
      vr: rand(-0.06, 0.06),
      alpha: rand(0.6, 0.95),
      color: "#fff",
      phase: rand(0, 6.28),
    };
    if (mode === "snow") {
      p.r = rand(1.3, 2.6);
      p.vy = rand(0.25, 0.5);
      p.vx = rand(-0.1, 0.1);
      p.color = "#B9D4E8";
    } else if (mode === "confetti") {
      p.r = rand(2.5, 4);
      p.vy = rand(0.5, 0.9);
      p.vx = rand(-0.25, 0.25);
      p.color = confetti[i % confetti.length];
    } else if (mode === "bubbles") {
      p.r = rand(3, 6);
      p.vy = -rand(0.25, 0.5);
      p.vx = rand(-0.08, 0.08);
      p.alpha = rand(0.4, 0.7);
    } else if (mode === "leaves") {
      p.r = rand(2.5, 4);
      p.vy = rand(0.3, 0.55);
      p.vx = rand(-0.15, 0.3);
      p.color = leaves[i % leaves.length];
    } else if (mode === "sparks") {
      p.r = rand(0.8, 1.4);
      p.vy = 0;
      p.vx = 0;
      p.color = "#F4C55C";
    } else if (mode === "petals") {
      p.r = rand(2.2, 3.6);
      p.vy = rand(0.25, 0.5);
      p.vx = rand(0.15, 0.4);
      p.color = petals[i % petals.length];
    }
    return p;
  });
}

function draw(ctx: CanvasRenderingContext2D, mode: string, p: Particle, t: number) {
  ctx.save();
  ctx.globalAlpha = p.alpha;
  if (mode === "snow") {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.29);
    ctx.fill();
  } else if (mode === "confetti") {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.62);
  } else if (mode === "bubbles") {
    ctx.strokeStyle = "rgba(120,170,200,0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.29);
    ctx.stroke();
    ctx.fillStyle = "rgba(200,230,250,0.85)";
    ctx.beginPath();
    ctx.arc(p.x - p.r * 0.32, p.y - p.r * 0.32, p.r * 0.22, 0, 6.29);
    ctx.fill();
  } else if (mode === "leaves") {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 6.29);
    ctx.fill();
  } else if (mode === "sparks") {
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(t / 350 + p.phase));
    ctx.globalAlpha = tw;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.7 + 0.6 * tw), 0, 6.29);
    ctx.fill();
  } else if (mode === "petals") {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r, p.r * 0.62, 0, 0, 6.29);
    ctx.fill();
  }
  ctx.restore();
}

// Салют — своя модель превью (не общее "поле частиц"): в маленьком чипе
// интервал между залпами укорочен до ~1–1.5с (в реальном движке — 3–5с,
// докс), иначе чип пустовал бы большую часть времени и "живого превью" не
// получилось бы разглядеть.
function runFireworksPreview(ctx: CanvasRenderingContext2D, W: number, H: number): () => void {
  const colors = ["#0F6E56", "#2E6BE6", "#E8478B"];
  let rocket: { x: number; y: number; targetY: number; vy: number; trail: { x: number; y: number }[] } | null = null;
  let sparks: { x: number; y: number; vx: number; vy: number; r: number; color: string; bornAt: number }[] = [];
  let nextLaunchAt = 0;
  let raf = 0;

  function launch(x: number) {
    rocket = { x, y: H, targetY: rand(H * 0.1, H * 0.35), vy: -Math.max(1.2, H * 0.045), trail: [] };
  }

  function burst(x: number, y: number, t: number) {
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * 6.283 + rand(-0.1, 0.1);
      const speed = rand(0.6, 1.5);
      sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: rand(0.7, 1.3), color: colors[i % 3], bornAt: t });
    }
    nextLaunchAt = t + rand(1000, 1500);
  }

  function step(t: number) {
    ctx.clearRect(0, 0, W, H);
    if (!rocket && sparks.length === 0) {
      if (nextLaunchAt === 0) nextLaunchAt = t + rand(200, 600);
      else if (t >= nextLaunchAt) launch(rand(W * 0.3, W * 0.7));
    }
    if (rocket) {
      rocket.trail.unshift({ x: rocket.x, y: rocket.y });
      if (rocket.trail.length > 4) rocket.trail.length = 4;
      rocket.y += rocket.vy;
      ctx.fillStyle = "#fff";
      for (const pt of rocket.trail) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1, 0, 6.29);
        ctx.fill();
      }
      if (rocket.y <= rocket.targetY) {
        burst(rocket.x, rocket.y, t);
        rocket = null;
      }
    }
    if (sparks.length > 0) {
      sparks = sparks.filter((s) => t - s.bornAt <= 700);
      for (const s of sparks) {
        s.vy += 0.045;
        s.x += s.vx;
        s.y += s.vy;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - (t - s.bornAt) / 700);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.29);
        ctx.fill();
        ctx.restore();
      }
    }
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export function EffectPreview({ mode, className }: { mode: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode === "none") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    if (mode === "fireworks") return runFireworksPreview(ctx, W, H);

    const particles = spawn(mode, W, H);

    let raf = 0;
    function step(t: number) {
      ctx!.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.y += p.vy;
        p.x += p.vx + (mode === "snow" || mode === "petals" ? Math.sin(t / 500 + p.phase) * 0.2 : 0);
        p.rot += p.vr;
        if (p.vy > 0 && p.y > H + 4) {
          p.y = -4;
          p.x = rand(0, W);
        }
        if (p.vy < 0 && p.y < -4) {
          p.y = H + 4;
          p.x = rand(0, W);
        }
        if (p.x > W + 4) p.x = -4;
        if (p.x < -4) p.x = W + 4;
        draw(ctx!, mode, p, t);
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  if (mode === "none") return null;
  return <canvas ref={canvasRef} width={64} height={40} className={className} aria-hidden="true" />;
}
