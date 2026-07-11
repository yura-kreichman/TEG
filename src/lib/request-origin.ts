/**
 * Публичный origin запроса для писем/QR-ссылок (activate-device, reset-password).
 * `new URL(request.url).origin` за реверс-прокси (nginx) отражает то, что видит
 * сам Node-процесс (localhost:3000), а не публичный домен — заголовки Host/
 * X-Forwarded-Proto пробрасываются явно (см. deploy/nginx/*.conf), читаем их.
 */
export function getRequestOrigin(request: Request): string {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
