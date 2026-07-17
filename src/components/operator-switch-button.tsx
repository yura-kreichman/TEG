"use client";

import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

// Кнопка "Сменить сотрудника" — перенесена в верхний бар PWA рядом с
// переключателем темы (запрос пользователя 2026-07-17, скриншот со
// стрелкой), доступна с любого экрана оператора, не только с Главной.
export function OperatorSwitchButton() {
  const router = useRouter();
  const t = useI18n();

  async function handleSwitchOperator() {
    await fetch("/api/auth/operator/logout", { method: "POST" });
    router.push("/operator/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground"
      onClick={handleSwitchOperator}
    >
      <ArrowRightLeft className="size-3.5" />
      {t.operatorApp.switchOperator}
    </button>
  );
}
