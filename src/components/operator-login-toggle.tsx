"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

// Зеркало OwnerLoginToggle (owner-login-toggle.tsx) — та же идея в обратную
// сторону (запрос пользователя 2026-07-29): устройство, которое одновременно
// и точка (PointDevice), и личное устройство Владельца. Видна ТОЛЬКО на
// /login и ТОЛЬКО когда это устройство уже активировано как точка —
// /api/auth/operator/me, тот же запрос, что и сама /operator/login использует
// для проверки статуса устройства. Для обычного личного телефона/ноутбука
// Владельца, никогда не активированного как точка, кнопки не будет вовсе.
export function OperatorLoginToggle() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useI18n();
  const [deviceActivated, setDeviceActivated] = useState(false);

  const onLoginScreen = pathname === "/login";

  useEffect(() => {
    if (!onLoginScreen) return;
    fetch("/api/auth/operator/me")
      .then((res) => res.json())
      .then((data) => setDeviceActivated(Boolean(data.device)));
  }, [onLoginScreen]);

  if (!onLoginScreen || !deviceActivated) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      className="rounded-lg"
      onClick={() => router.push("/operator/login")}
      aria-label={t.auth.loginAsOperatorLink}
    >
      <Users className="size-3.5" />
    </Button>
  );
}
