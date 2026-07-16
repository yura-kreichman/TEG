"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerShell } from "@/components/owner-shell";
import { useI18n } from "@/components/i18n-provider";

// Раньше показывал список точек для выбора — убрано (фидбек пользователя
// 2026-07-13, "без лишнего экрана выбора точки"). Всегда ведёт на первую
// точку; переключение между точками теперь — dropdown прямо на
// /tasks/[pointId] (см. тот же фидбек).
export default function TasksRedirectPage() {
  const router = useRouter();
  const t = useI18n();
  const [noPoints, setNoPoints] = useState(false);

  useEffect(() => {
    fetch("/api/points")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        const first = data.points?.[0];
        if (first) {
          router.replace(`/tasks/${first.id}`);
        } else {
          setNoPoints(true);
        }
      });
  }, [router]);

  if (!noPoints) return null;

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl md:max-w-3xl lg:max-w-4xl flex-col gap-1">
          <h1 className="text-screen-title">{t.tasks.pickPointTitle}</h1>
          <p className="text-body-airbnb text-muted-foreground">{t.tasks.noPoints}</p>
        </div>
      </div>
    </OwnerShell>
  );
}
