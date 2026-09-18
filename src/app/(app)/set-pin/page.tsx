"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";

export default function SetPinPage() {
  const router = useRouter();
  const t = useI18n();
  const [checking, setChecking] = useState(true);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!data.user) {
          router.replace("/login");
          return;
        }
        setChecking(false);
      });
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^\d{4,6}$/.test(pin)) {
      setError(t.auth.pinFormatError);
      return;
    }
    if (pin !== confirmPin) {
      setError(t.auth.pinMismatch);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось сохранить ПИН-код");
        return;
      }

      // Сразу на главную, без выхода из аккаунта (docs/spec/13-onboarding.md):
      // раньше здесь был выход «чтобы проверить новый ПИН», и новый владелец
      // сразу после регистрации оказывался на экране входа — «меня выкинуло».
      // Проверить ПИН он успеет при следующем входе.
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return null;
  }

  return (
    <AuthCard>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-screen-title">{t.auth.setPinTitle}</h1>
          <p className="mt-1 text-body-airbnb text-muted-foreground">{t.auth.setPinHint}</p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="pin">{t.auth.newPinLabel}</Label>
          {/* Не type="password" — см. поле ПИН на /login: иначе Chrome
              предлагает сохранить ПИН как пароль аккаунта. */}
          <Input
            id="pin"
            type="text"
            inputMode="numeric"
            pattern="\d{4,6}"
            required
            autoComplete="one-time-code"
            data-1p-ignore
            data-lpignore="true"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="h-14 text-lg tabular-nums [-webkit-text-security:disc]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="confirmPin">{t.auth.confirmPinLabel}</Label>
          <Input
            id="confirmPin"
            type="text"
            inputMode="numeric"
            pattern="\d{4,6}"
            required
            autoComplete="one-time-code"
            data-1p-ignore
            data-lpignore="true"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            className="h-14 text-lg tabular-nums [-webkit-text-security:disc]"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <PressableScale>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? t.auth.saving : t.auth.savePinButton}
          </Button>
        </PressableScale>

        <button
          type="button"
          onClick={() => router.push("/")}
          disabled={loading}
          className="text-center text-sm text-muted-foreground underline underline-offset-2"
        >
          {t.auth.cancelLater}
        </button>
      </form>
    </AuthCard>
  );
}
