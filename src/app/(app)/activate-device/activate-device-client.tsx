"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { useI18n } from "@/components/i18n-provider";

export default function ActivateDeviceClient({ token }: { token: string }) {
  const t = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState<"activating" | "done" | "error">("activating");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/activate-device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Не удалось активировать устройство");
          setStatus("error");
          return;
        }
        setStatus("done");
      })
      .catch(() => {
        if (!cancelled) {
          setError("Не удалось связаться с сервером");
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Автопереход на вход Оператора вместо ручного клика по ссылке (найдено
  // 2026-07-14 при разборе реального прод-бага с ПИН-кодом — не была
  // причиной, но лишний ручной шаг здесь ничему не помогает; небольшая
  // задержка — чтобы сообщение об успехе было видно, а не мигало).
  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(() => router.push("/operator/login"), 1200);
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <AuthCard className="flex flex-col gap-4">
      <h1 className="text-screen-title">{t.auth.activateTitle}</h1>

      {status === "activating" && (
        <p className="text-body-airbnb text-muted-foreground">{t.auth.activating}</p>
      )}
      {status === "done" && (
        <>
          <p className="text-sm text-success">{t.auth.activateDone}</p>
          <a href="/operator/login" className="text-sm underline underline-offset-2">
            {t.auth.goToOperatorLogin}
          </a>
        </>
      )}
      {status === "error" && (
        <>
          <p className="text-sm text-destructive">{error}</p>
          <p className="text-body-airbnb text-muted-foreground">{t.auth.activateErrorHint}</p>
          <a href="/operator/login" className="text-sm underline underline-offset-2">
            {t.auth.goToOperatorLogin}
          </a>
        </>
      )}
    </AuthCard>
  );
}
