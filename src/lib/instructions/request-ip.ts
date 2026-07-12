// IP клиента за реверс-прокси nginx (deploy/nginx/*.conf: proxy_set_header
// X-Real-IP $remote_addr) — единственное значение, не список, в отличие от
// X-Forwarded-For (используется как фолбэк на случай другого окружения).
export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();

  return "unknown";
}
