// Кнопка "Поделиться" публичного Лендинга (docs/spec/08-landing.md, Шаг 4) —
// намеренно НЕ React-компонент: единственный клиентский код на странице,
// подключается как обычный статический <script>, минуя весь бюндл
// React/ReactDOM-хайдрации (~230КБ), который иначе пришлось бы грузить ради
// одной кнопки — см. "Производительность" в спеке (бюджет JS ~200KB gzip,
// это фреймворковый минимум Next-рантайма — см. CLAUDE.md).
(function () {
  function onClick(event) {
    var btn = event.currentTarget;
    var title = btn.getAttribute("data-share-title") || "";
    var url = btn.getAttribute("data-share-url") || window.location.href;

    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () {});
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        var original = btn.textContent;
        var copiedLabel = btn.getAttribute("data-share-copied-label");
        if (copiedLabel) {
          btn.textContent = copiedLabel;
          setTimeout(function () {
            btn.textContent = original;
          }, 1500);
        }
      });
    }
  }

  document.querySelectorAll("[data-share-button]").forEach(function (btn) {
    btn.addEventListener("click", onClick);
  });
})();
