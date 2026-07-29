"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionToast } from "@/components/action-toast";
import { useI18n } from "@/components/i18n-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { playErrorChime } from "@/lib/beep";

type DeviceStatus = "checking" | "unknown" | "ready";

export default function OperatorLoginPage() {
  const t = useI18n();
  const searchParams = useSearchParams();
  // Режим — из query (?as=owner), не React state (запрос пользователя
  // 2026-07-29): переключатель теперь живёт в верхнем баре (OwnerLoginToggle,
  // operator/layout.tsx) — соседний, не дочерний компонент этой страницы,
  // общий стейт пришлось бы тащить через контекст ради одной кнопки, URL —
  // источник истины, который читают оба места одинаково.
  const loginMode = searchParams.get("as") === "owner" ? "owner" : "operator";

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>("checking");
  const [pointName, setPointName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const errorToast = useActionToast();

  const [ownerPin, setOwnerPin] = useState("");
  const [ownerLoading, setOwnerLoading] = useState(false);

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

  async function handleOwnerSubmit(event: FormEvent) {
    event.preventDefault();
    setOwnerLoading(true);

    try {
      // /api/auth/login с {pin} резолвит аккаунт ТОЛЬКО через owner_device
      // cookie этого браузера (см. api/auth/login/route.ts) — не слепой пул,
      // как у операторского ПИНа выше, поэтому переиспользуем эндпоинт как
      // есть, не заводим отдельный.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: ownerPin }),
      });
      const data = await res.json();

      if (!res.ok) {
        playErrorChime();
        errorToast.flash(data.error ?? "Не удалось войти", "error");
        setOwnerPin("");
        return;
      }

      window.location.href = "/";
    } finally {
      setOwnerLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/auth/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Zoom-in+bounce по центру со звуком ошибки (запрос пользователя
        // 2026-07-25) — тот же приём, что "Заказ не найден"/"Клиент не
        // найден"; PIN сбрасывается сразу, вводить заново с нуля.
        playErrorChime();
        errorToast.flash(data.error ?? "Не удалось войти", "error");
        setPin("");
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
      <h1 className="text-screen-title">
        {loginMode === "owner" ? t.auth.ownerLoginViaPinTitle : t.auth.operatorLoginTitle}
      </h1>

      {loginMode === "operator" && deviceStatus === "unknown" && (
        <p className="text-body-airbnb text-muted-foreground">{t.auth.operatorDeviceUnknownHint}</p>
      )}

      {loginMode === "operator" && deviceStatus === "ready" && (
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

          <PressableScale>
            <Button type="submit" disabled={loading} className="h-14 w-full rounded-control text-base font-bold">
              {loading ? t.auth.loggingIn : t.auth.loginButton}
            </Button>
          </PressableScale>
        </form>
      )}

      {/* Форма Владельца переиспользует /api/auth/login {pin} как есть — тот же
          эндпоинт, что и ПИН-таб на /login, резолвит аккаунт только через
          owner_device cookie ЭТОГО браузера, слепого угадывания нет. */}
      {loginMode === "owner" && (
        <form onSubmit={handleOwnerSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="owner-pin">{t.auth.pinLabel}</Label>
            <Input
              id="owner-pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              required
              autoComplete="off"
              autoFocus
              value={ownerPin}
              onChange={(e) => setOwnerPin(e.target.value)}
              className="h-14 border-2 text-lg tabular-nums"
            />
          </div>

          <PressableScale>
            <Button type="submit" disabled={ownerLoading} className="h-14 w-full rounded-control text-base font-bold">
              {ownerLoading ? t.auth.loggingIn : t.auth.loginButton}
            </Button>
          </PressableScale>
        </form>
      )}

      <ActionToast message={errorToast.message} variant={errorToast.variant} />
    </AuthCard>
  );
}
