/**
 * Публичный origin запроса для писем/QR-ссылок (activate-device, reset-password).
 * `new URL(request.url).origin` за реверс-прокси (nginx) отражает то, что видит
 * сам Node-процесс (localhost:3000), а не публичный домен — заголовки Host/
 * X-Forwarded-Proto пробрасываются явно (см. deploy/nginx/*.conf), читаем их.
 *
 * APP_ORIGIN — приоритетнее заголовков (аудит 2026-08-13). Заголовок Host
 * присылает клиент, а из этой функции строится ссылка сброса пароля, которая
 * УХОДИТ ЖЕРТВЕ В ПИСЬМЕ: запрос "забыли пароль" с подменённым Host заставлял
 * бы сервер отправить владельцу настоящее письмо с настоящим токеном, но
 * ссылкой на чужой домен — классическое отравление сброса пароля. На этом
 * деплое подмена сейчас не проходит (проверено вживую: nginx отвечает 404 на
 * незнакомый Host), но защита стояла целиком снаружи приложения и держалась на
 * том, что в панели останется ровно эта конфигурация виртуальных хостов.
 *
 * Заголовки остаются фоллбэком, а не удаляются: без переменной окружения
 * (локальная разработка, docker-compose без APP_ORIGIN) ссылки должны
 * продолжать работать, а там доверять Host безопасно — публичного трафика нет.
 */
export function getRequestOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
