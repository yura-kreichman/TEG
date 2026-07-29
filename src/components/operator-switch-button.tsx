"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

// Кнопка "Сменить сотрудника" — перенесена в верхний бар PWA рядом с
// переключателем темы (запрос пользователя 2026-07-17, скриншот со
// стрелкой), доступна с любого экрана оператора, не только с Главной.
//
// На /operator/login она сама по себе не актуальна (запрос пользователя
// 2026-07-29: там ещё никто не залогинен, "сменить" нечего) — вместо неё
// в том же слоте верхнего бара показывается OwnerLoginToggle (см. рядом,
// operator/layout.tsx рендерит их подряд, оба сами скрывают себя по
// pathname, поэтому виден максимум один одновременно).
export function OperatorSwitchButton() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useI18n();

  if (pathname === "/operator/login") return null;

  async function handleSwitchOperator() {
    await fetch("/api/auth/operator/logout", { method: "POST" });
    router.push("/operator/login");
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="xs" className="gap-1.5 rounded-lg" onClick={handleSwitchOperator}>
      <ArrowRightLeft className="size-3.5" />
      {t.operatorApp.switchOperator}
    </Button>
  );
}
