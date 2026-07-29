"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Crown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

// Переключатель "Войти как Владелец"/"Назад ко входу сотрудника" — раньше
// был текстовой ссылкой ВНУТРИ карточки (запрос пользователя 2026-07-29),
// перенесён в верхний бар рядом со "Сменить сотрудника" (там она не
// актуальна на этом экране — см. operator-switch-button.tsx) в виде одной
// иконки: корона — сейчас на экране Сотрудника, нажатие ведёт на вход
// Владельца; users — сейчас на экране Владельца, нажатие возвращает на
// вход Сотрудника. Режим — через query-параметр (?as=owner), а не React
// state внутри operator/login/page.tsx — эта кнопка физически рендерится
// РОДИТЕЛЬСКИМ layout.tsx, соседним, а не дочерним компонентом страницы,
// общий стейт пришлось бы тащить через контекст ради одной кнопки; URL —
// более простой источник истины, который оба компонента читают одинаково.
export function OwnerLoginToggle() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useI18n();
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);

  const onLoginScreen = pathname === "/operator/login";

  useEffect(() => {
    if (!onLoginScreen) return;
    fetch("/api/auth/owner-device")
      .then((res) => res.json())
      .then((data) => setOwnerEmail(data.email));
  }, [onLoginScreen]);

  // Не только не на экране входа, но и когда этот браузер не узнан как
  // чей-то личный (owner_device cookie) — тогда переключаться некуда, тот
  // же критерий видимости, что раньше был у текстовой ссылки.
  if (!onLoginScreen || !ownerEmail) return null;

  const isOwnerMode = searchParams.get("as") === "owner";

  function toggle() {
    const params = new URLSearchParams(searchParams);
    if (isOwnerMode) {
      params.delete("as");
    } else {
      params.set("as", "owner");
    }
    const qs = params.toString();
    router.push(qs ? `/operator/login?${qs}` : "/operator/login");
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      className="rounded-lg"
      onClick={toggle}
      aria-label={isOwnerMode ? t.auth.backToOperatorLoginLink : t.auth.loginAsOwnerLink}
    >
      {isOwnerMode ? <Users className="size-3.5" /> : <Crown className="size-3.5" />}
    </Button>
  );
}
