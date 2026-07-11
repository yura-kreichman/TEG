import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";
import { getVapidPublicKey } from "@/lib/push-notifications";

// Отдаётся как API-роут, не NEXT_PUBLIC_*-переменная — этот проект собирает
// Docker-образ один раз и настраивает секреты через .env на рантайме
// (docker-compose.prod.yml), а NEXT_PUBLIC_* Next.js запекает в бандл на
// этапе сборки. Ключ не секретный сам по себе (публичная половина VAPID-пары,
// предназначен для передачи в браузер), но всё равно только для владельца —
// не нужно отдавать его анонимно.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) {
    return NextResponse.json({ error: "Требуется вход владельца" }, { status: 401 });
  }

  const publicKey = await getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: "Push-уведомления не настроены на сервере" }, { status: 503 });
  }

  return NextResponse.json({ publicKey });
}
