// Клик по фасаду видео (docs/spec/08-landing.md, "Секция видео") — обычный
// <script defer>, не React (тот же принцип, что landing-share.js: одна
// клиентская React-кнопка тянет ~230КБ react-dom, обычный DOM-скрипт — нет).
// iframe создаётся ТОЛЬКО здесь, по клику посетителя — до клика в разметке
// его нет вообще (докс: "до клика — ноль внешних запросов").
document.querySelectorAll("[data-video-play]").forEach(function (button) {
  button.addEventListener("click", function () {
    var videoId = button.getAttribute("data-video-id");
    var wrapper = button.closest("div");
    if (!wrapper || !videoId) return;

    // Параметры скрывают чужой UI плеера (докс: своя обложка/кнопка Play,
    // без брендинга YouTube) — controls=0 убирает весь нижний бар (плей/пауза,
    // шкала, громкость, настройки, fullscreen) и верхнюю плашку с названием;
    // rel=0 + loop=1&playlist={id} (официальный трюк зацикливания одного
    // видео) убирают экран "другие видео" в конце; modestbranding уменьшает
    // логотип YouTube на оставшемся статичном кадре.
    var iframe = document.createElement("iframe");
    iframe.src =
      "https://www.youtube-nocookie.com/embed/" +
      videoId +
      "?autoplay=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&playsinline=1&loop=1&playlist=" +
      videoId;
    iframe.loading = "lazy";
    iframe.allow = "autoplay; encrypted-media";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";

    var container = wrapper.parentElement;
    if (!container) return;
    var poster = container.querySelector("img");
    if (poster) poster.style.display = "none";
    wrapper.style.display = "none";
    container.appendChild(iframe);
  });
});
