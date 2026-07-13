// Лайтбокс для фото галереи/активов (docs/spec/08-landing.md) — обычный
// <script defer>, не React, тот же принцип, что landing-video.js/landing-
// share.js: разметку и иконки (Lucide) рендерит сервер один раз в
// LightboxSkeleton, скрипт только переключает класс/src, ничего не строит
// через innerHTML. Коллекции собираются по data-lightbox-group: у галереи
// одна общая группа "gallery", у каждой зоны своя лента активов и свой
// фото-хедер — свайп/стрелки не смешивают фото из разных карточек.
(function () {
  var overlay = document.querySelector(".lt-lightbox");
  if (!overlay) return;

  var groups = {};
  document.querySelectorAll("[data-lightbox-group]").forEach(function (el) {
    var group = el.getAttribute("data-lightbox-group");
    var src = el.getAttribute("data-lightbox-src") || el.src;
    if (!groups[group]) groups[group] = [];
    var index = groups[group].length;
    groups[group].push({ src: src, alt: el.alt || "" });
    el.addEventListener("click", function () {
      open(group, index);
    });
  });

  var imgEl = overlay.querySelector("[data-lightbox-img]");
  var counterEl = overlay.querySelector("[data-lightbox-counter]");
  var prevBtn = overlay.querySelector("[data-lightbox-prev]");
  var nextBtn = overlay.querySelector("[data-lightbox-next]");
  var currentGroup = null;
  var currentIndex = 0;

  overlay.querySelector("[data-lightbox-close]").addEventListener("click", close);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
  prevBtn.addEventListener("click", function () {
    step(-1);
  });
  nextBtn.addEventListener("click", function () {
    step(1);
  });

  document.addEventListener("keydown", function (e) {
    if (!overlay.classList.contains("is-open")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  var touchStartX = null;
  overlay.addEventListener(
    "touchstart",
    function (e) {
      touchStartX = e.touches[0].clientX;
    },
    { passive: true }
  );
  overlay.addEventListener("touchend", function (e) {
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) step(dx > 0 ? -1 : 1);
    touchStartX = null;
  });

  function render() {
    var list = groups[currentGroup];
    var item = list[currentIndex];
    imgEl.src = item.src;
    imgEl.alt = item.alt;
    var multi = list.length > 1;
    prevBtn.style.display = multi ? "" : "none";
    nextBtn.style.display = multi ? "" : "none";
    counterEl.style.display = multi ? "" : "none";
    counterEl.textContent = currentIndex + 1 + " / " + list.length;
  }

  function step(delta) {
    var list = groups[currentGroup];
    currentIndex = (currentIndex + delta + list.length) % list.length;
    render();
  }

  function open(group, index) {
    currentGroup = group;
    currentIndex = index;
    render();
    overlay.classList.add("is-open");
    document.documentElement.style.overflow = "hidden";
  }

  function close() {
    overlay.classList.remove("is-open");
    document.documentElement.style.overflow = "";
  }
})();

// Автопрокрутка + центр-детект лент — ОДИН rAF-цикл на ленту (докс, уточнено
// пользователем 2026-07-13 дважды: "как бегущая строка", а не дискретные
// прыжки, и "жёсткий скроллинг" — оказалось, что старая версия держала ДВА
// независимых цикла: автопрокрутка через requestAnimationFrame + отдельный
// центр-детект, который на КАЖДЫЙ scroll-евент гонял getBoundingClientRect
// по ВСЕМ элементам ленты — при нескольких лентах на странице одновременно
// (галерея + лента на каждую зону) это давало заметный layout thrashing и
// дёрганость. Теперь: ширина шага (итем+gap) меряется ОДИН раз при старте
// (единственное обращение к layout), дальше — только дешёвая арифметика
// scrollLeft/step, без единого getBoundingClientRect в кадровом цикле.
// Разметка каждой ленты (GallerySection/ZoneFleetStrip в sections.tsx)
// дублирует свой комплект тайлов дважды — автопрокрутка сбрасывается не в 0,
// а ровно на ширину ОДНОГО комплекта, и поскольку там та же картинка,
// переход визуально бесшовный.
// ВАЖНО (найдено эмпирически 2026-07-13): strip.scrollLeft округляется
// браузером до целого пикселя при каждом присваивании — если на каждом кадре
// читать scrollLeft обратно и прибавлять к нему PX_PER_FRAME < 1, дробная
// часть каждый раз теряется и лента визуально не двигается вообще. Позиция
// поэтому копится в СВОЕЙ переменной pos, а не читается обратно из
// scrollLeft (кроме центр-детекта — там чтение допустимо, это не
// накопительная арифметика). Автопрокрутка не запускается на
// prefers-reduced-motion, но центр-детект (масштаб/поворот активного
// элемента) продолжает реагировать на РУЧНОЙ свайп — это не движение, а
// статичная реакция на позицию.
// ВАЖНО #2 (тоже найдено эмпирически 2026-07-13): даже window.load —
// недостаточно надёжный сигнал "гидрация точно завершена". В dev-режиме
// (Turbopack) гидрация большого дерева иногда занимает дольше, чем загрузка
// (маленьких, локальных) картинок, и window.load срабатывает РАНЬШЕ —
// classList.toggle в этот момент гонится с React и даёт "attributes didn't
// match" (та же причина, что уже дважды чинили в этом файле).
// requestIdleCallback — более надёжный сигнал: браузер вызывает его только
// когда нет ожидающей высокоприоритетной работы (а гидрация — именно такая),
// не жёстко зашитая задержка "на глаз". Таймаут-фолбэк — на случай, если
// браузер (Safari) requestIdleCallback не поддерживает вовсе.
function whenIdle(fn) {
  if ("requestIdleCallback" in window) {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 300);
  }
}

window.addEventListener("load", function () {
  whenIdle(function () {
    var canAutoScroll = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    var PX_PER_FRAME = 1.4;

    function setupStrip(strip, opts) {
      var items = strip.children;
      if (items.length < 2) return;
      var step = items[1].offsetLeft - items[0].offsetLeft;
      if (!step) return;
      var dots = opts.dots || [];
      // Реальный размер комплекта — по количеству элементов БЕЗ aria-hidden
      // (декоративная копия для бесшовного цикла всегда так помечена в
      // sections.tsx), а не по items.length/2 "на глаз" — надёжно работает
      // и для галереи, и для любой ленты активов независимо от её размера.
      var realCount = 0;
      for (var c = 0; c < items.length; c++) {
        if (items[c].getAttribute("aria-hidden") !== "true") realCount++;
      }
      var oneSetWidth = step * realCount;

      var pos = strip.scrollLeft;
      var paused = false;
      var resumeTimer = null;
      function pauseForAWhile() {
        paused = true;
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(function () {
          paused = false;
          pos = strip.scrollLeft;
        }, 6000);
      }
      strip.addEventListener("pointerdown", pauseForAWhile, { passive: true });
      strip.addEventListener("wheel", pauseForAWhile, { passive: true });

      function applyClasses() {
        var closestIndex = Math.round(strip.scrollLeft / step);
        var wrapped = ((closestIndex % items.length) + items.length) % items.length;
        for (var j = 0; j < items.length; j++) {
          items[j].classList.remove("is-centered", "is-left", "is-right");
          if (j === wrapped) {
            items[j].classList.add("is-centered");
          } else if (opts.rotate) {
            items[j].classList.add(j < wrapped ? "is-left" : "is-right");
          }
        }
        if (dots.length > 0) {
          var activeDot = ((wrapped % dots.length) + dots.length) % dots.length;
          for (var k = 0; k < dots.length; k++) {
            dots[k].classList.toggle("is-active", k === activeDot);
          }
        }
      }

      function tick() {
        if (canAutoScroll && !paused && !document.hidden && oneSetWidth > strip.clientWidth + 1) {
          pos += PX_PER_FRAME;
          if (pos >= oneSetWidth) pos -= oneSetWidth;
          strip.scrollLeft = pos;
        }
        applyClasses();
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    var gallery = document.querySelector(".lt-gallery-strip");
    if (gallery) {
      setupStrip(gallery, { rotate: true, dots: document.querySelectorAll(".lt-gallery-dot") });
    }
    document.querySelectorAll(".lt-fleet-strip").forEach(function (strip) {
      setupStrip(strip, { rotate: false, dots: [] });
    });
  });
});
