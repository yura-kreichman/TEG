// Canvas-движок частиц (docs/spec/08-landing.md, "Эффекты лендинга").
// Референс поведения и физики — rentos-темы-и-эффекты.html (корень проекта),
// но не копия: без демо-панели переключателей, цвет "Конфетти" читается из
// CSS-переменных темы (--lt-fx-color-1/2/3, акцентная схема тенанта) вместо
// хардкод-массива демо-файла. ES-модуль, без внешних библиотек — импортируется
// динамически ТОЛЬКО когда у тенанта включён эффект (mode !== "none" никогда
// не передаётся: страница просто не подключает этот файл вовсе, если эффект
// выключен, см. вызывающий код в src/components/landing/sections.tsx).
//
// "Салют" (fireworks) — отдельная модель, не общий "поле частиц" остальных
// 6 эффектов (докс, решение пользователя 2026-07-13): эталонного демо-файла
// с салютом в проекте НЕ нашлось (rentos-темы-и-эффекты.html его не
// содержит) — физика ниже подобрана самостоятельно по словесному ТЗ
// пользователя, не скопирована из референса. Если у пользователя найдётся
// точный эталон — параметры (скорость ракеты, гравитация, время жизни искры)
// подлежат пересмотру.

const PARTICLE_COUNT = { snow: 45, confetti: 45, bubbles: 22, leaves: 45, sparks: 26, petals: 45 };

// 9 акцентных пресетов платформы (src/app/globals.css, светлый режим) —
// canvas fillStyle понимает oklch() нативно, конвертация в hex не нужна.
const PLATFORM_ACCENTS = [
  "oklch(0.52 0.13 149)",
  "oklch(0.5 0.16 258)",
  "oklch(0.63 0.19 45)",
  "oklch(0.5 0.19 302)",
  "oklch(0.55 0.12 195)",
  "oklch(0.62 0.2 25)",
  "oklch(0.58 0.22 350)",
  "oklch(0.5 0.18 275)",
  "oklch(0.68 0.15 85)",
];

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function readAccentPalette() {
  const s = getComputedStyle(document.documentElement);
  const fallback = ["#0F6E56", "#2E6BE6", "#E8478B"];
  return [
    s.getPropertyValue("--lt-fx-color-1").trim() || fallback[0],
    s.getPropertyValue("--lt-fx-color-2").trim() || fallback[1],
    s.getPropertyValue("--lt-fx-color-3").trim() || fallback[2],
  ];
}

function pickTwoDistinct(arr) {
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * arr.length);
  while (j === i) j = Math.floor(Math.random() * arr.length);
  return [arr[i], arr[j]];
}

export function start(mode) {
  if (mode !== "fireworks" && !PARTICLE_COUNT[mode]) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:40";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  const palette = readAccentPalette();
  let particles = [];
  let raf = null;
  let dead = false;
  let lastTime = 0;
  let fpsWindow = [];

  // ===== "Поле частиц" — Снег/Конфетти/Пузыри/Листопад/Искорки/Лепестки =====
  function spawnField() {
    particles = [];
    const count = PARTICLE_COUNT[mode];
    for (let i = 0; i < count; i++) {
      const p = {
        x: rand(0, width),
        y: rand(-height, height),
        r: 0,
        vx: 0,
        vy: 0,
        rot: rand(0, 6.28),
        vr: rand(-0.03, 0.03),
        alpha: rand(0.5, 0.95),
        color: "#fff",
        phase: rand(0, 6.28),
      };
      if (mode === "snow") {
        p.r = rand(1.5, 4.5);
        p.vy = rand(0.4, 1.2);
        p.vx = rand(-0.2, 0.2);
      } else if (mode === "confetti") {
        p.r = rand(3.5, 6);
        p.vy = rand(1.0, 2.0);
        p.vx = rand(-0.4, 0.4);
        p.color = palette[i % palette.length];
      } else if (mode === "bubbles") {
        p.r = rand(6, 16);
        p.y = rand(height, 2 * height);
        p.vy = -rand(0.4, 1.0);
        p.vx = rand(-0.15, 0.15);
        p.alpha = rand(0.25, 0.5);
      } else if (mode === "leaves") {
        p.r = rand(4.5, 8);
        p.vy = rand(0.5, 1.1);
        p.vx = rand(-0.3, 0.5);
        p.color = ["#C97B2D", "#B3541E", "#D9A036"][i % 3];
      } else if (mode === "sparks") {
        p.r = rand(1, 2.4);
      } else if (mode === "petals") {
        p.r = rand(4, 7);
        p.vy = rand(0.5, 1.0);
        p.vx = rand(0.3, 0.9);
        p.color = ["#F5A8C0", "#EF8BAE", "#FBD1DE"][i % 3];
      }
      particles.push(p);
    }
  }

  function stepField(t) {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.y += p.vy;
      p.x += p.vx + (mode === "snow" || mode === "petals" ? Math.sin(t / 900 + p.phase) * 0.3 : 0);
      p.rot += p.vr;
      if (p.vy > 0 && p.y > height + 16) {
        p.y = -16;
        p.x = rand(0, width);
      }
      if (p.vy < 0 && p.y < -20) {
        p.y = height + 20;
        p.x = rand(0, width);
      }
      if (p.x > width + 16) p.x = -16;
      if (p.x < -16) p.x = width + 16;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      if (mode === "snow") {
        ctx.fillStyle = "#B9D4E8";
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
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.29);
        ctx.stroke();
        ctx.fillStyle = "rgba(200,230,250,0.85)";
        ctx.beginPath();
        ctx.arc(p.x - p.r * 0.32, p.y - p.r * 0.32, p.r * 0.18, 0, 6.29);
        ctx.fill();
      } else if (mode === "leaves") {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 6.29);
        ctx.fill();
      } else if (mode === "sparks") {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t / 700 + p.phase));
        ctx.globalAlpha = tw * 0.9;
        ctx.fillStyle = "#F4C55C";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.8 + 0.4 * tw), 0, 6.29);
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
  }

  // ===== "Салют" — одиночные залпы, не непрерывный поток =====
  // Ракета взлетает раз в 3–5с из случайной точки центральных 50% ширины,
  // лопается в верхней трети вьюпорта ~30 искрами по кругу с гравитацией и
  // затуханием за ~1.5с. Между залпами canvas пуст (докс, решение
  // пользователя 2026-07-13).
  let rocket = null;
  let sparks = [];
  let nextLaunchAt = 0;

  function launchRocket(t) {
    const x = rand(width * 0.25, width * 0.75);
    rocket = {
      x,
      y: height,
      targetY: rand(height * 0.08, height * 0.33),
      vy: -Math.max(3, height * 0.012),
      trail: [],
    };
    nextLaunchAt = 0; // следующий залп планируется при взрыве, не сейчас
    void t;
  }

  function burst(x, y, t) {
    const [tenantColor] = readAccentPalette();
    const [a, b] = pickTwoDistinct(PLATFORM_ACCENTS);
    const colors = [tenantColor, a, b];
    const count = 30;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 6.283 + rand(-0.08, 0.08);
      const speed = rand(1.3, 3.2);
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: rand(1, 2.2),
        color: colors[i % colors.length],
        bornAt: t,
      });
    }
    nextLaunchAt = t + rand(3000, 5000);
  }

  function stepFireworks(t) {
    ctx.clearRect(0, 0, width, height);

    if (!rocket && sparks.length === 0) {
      if (nextLaunchAt === 0) nextLaunchAt = t + rand(3000, 5000);
      else if (t >= nextLaunchAt) launchRocket(t);
    }

    if (rocket) {
      rocket.trail.unshift({ x: rocket.x, y: rocket.y });
      if (rocket.trail.length > 5) rocket.trail.length = 5;
      rocket.y += rocket.vy;

      for (let i = rocket.trail.length - 1; i >= 0; i--) {
        const pt = rocket.trail[i];
        ctx.save();
        ctx.globalAlpha = (1 - i / rocket.trail.length) * 0.5;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.8 * (1 - i / rocket.trail.length), 0, 6.29);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(rocket.x, rocket.y, 2.2, 0, 6.29);
      ctx.fill();
      ctx.restore();

      if (rocket.y <= rocket.targetY) {
        burst(rocket.x, rocket.y, t);
        rocket = null;
      }
    }

    if (sparks.length > 0) {
      sparks = sparks.filter((s) => t - s.bornAt <= 1500);
      for (const s of sparks) {
        s.vy += 0.035; // гравитация
        s.x += s.vx;
        s.y += s.vy;
        const age = t - s.bornAt;
        const alpha = Math.max(0, 1 - age / 1500);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.29);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function step(t) {
    // FPS-failsafe (докс): средний FPS < 30 за окно ~300 кадров (~5с при 60fps)
    // — эффект гасится до конца сессии, не перезапускается переключателями.
    // Действует одинаково для "поля частиц" и для "Салюта" — без исключений.
    if (lastTime) {
      fpsWindow.push(1000 / (t - lastTime));
      if (fpsWindow.length > 300) fpsWindow.shift();
      if (fpsWindow.length === 300) {
        const avg = fpsWindow.reduce((a, b) => a + b, 0) / 300;
        if (avg < 30) {
          dead = true;
          stop();
          ctx.clearRect(0, 0, width, height);
          return;
        }
      }
    }
    lastTime = t;

    if (mode === "fireworks") stepFireworks(t);
    else stepField(t);

    raf = requestAnimationFrame(step);
  }

  function stop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    lastTime = 0;
    fpsWindow = [];
  }

  function run() {
    stop();
    ctx.clearRect(0, 0, width, height);
    if (!dead) {
      if (mode === "fireworks") {
        rocket = null;
        sparks = [];
        nextLaunchAt = 0;
      } else {
        spawnField();
      }
      raf = requestAnimationFrame(step);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else if (!dead && !raf) {
      raf = requestAnimationFrame(step);
    }
  });

  run();
}
