"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";

type DeviceStatus = "checking" | "unknown" | "ready";

export default function OperatorLoginPage() {
  const t = useI18n();
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>("checking");
  const [pointName, setPointName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/operator/me")
      .then((res) => res.json())
      .then((data) => {
        if (!data.device) {
          setDeviceStatus("unknown");
          return;
        }
        setPointName(data.device.pointName);
        setDeviceStatus("ready");
      });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось войти");
        return;
      }

      // Полная навигация, не router.push (реальный баг, найден пользователем
      // 2026-07-22: кнопки в нижнем баре не появлялись сразу после входа,
      // только после ручного обновления страницы) — OperatorBottomNav живёт
      // на уровне layout (operator/layout.tsx) и грузит доступные зоны/
      // goodsAccess один раз при монтировании (useEffect с []); при
      // router.push этот layout не размонтируется/не перемонтируется между
      // /operator/login и /operator, поэтому эффект не перезапускается и
      // бар остаётся с состоянием "до входа". Тот же корень, что уже чинили
      // 2026-07-19 для смены точки (см. handleSwitchPoint в operator/page.tsx) —
      // там же полным reload'ом, не точечным рефетчем.
      window.location.href = "/operator";
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard className="flex flex-col gap-4">
      <h1 className="text-screen-title">{t.auth.operatorLoginTitle}</h1>

      {deviceStatus === "unknown" && (
        <p className="text-body-airbnb text-muted-foreground">{t.auth.operatorDeviceUnknownHint}</p>
      )}

      {deviceStatus === "ready" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {pointName && (
            <p className="text-body-airbnb text-muted-foreground">
              {t.auth.pointLabel}: {pointName}
            </p>
          )}

          {/* Outdoor-contrast floor per docs/spec/03-design-system.md: a visibly
              thicker border than the owner-side inputs, min 56px tap target. */}
          <div className="flex flex-col gap-1">
            <Label htmlFor="pin">{t.auth.pinLabel}</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              required
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="h-14 border-2 text-lg tabular-nums"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <PressableScale>
            <Button type="submit" disabled={loading} className="h-14 w-full rounded-control text-base font-bold">
              {loading ? t.auth.loggingIn : t.auth.loginButton}
            </Button>
          </PressableScale>
        </form>
      )}
    </AuthCard>
  );
}
