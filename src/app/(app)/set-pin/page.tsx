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

      // Log out so the user immediately proves the new PIN works by logging back in with it.
      await fetch("/api/auth/logout", { method: "POST" });
      window.sessionStorage.setItem("teg:pinJustSet", "1");
      router.push("/login");
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
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            pattern="\d{4,6}"
            required
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="h-14 text-lg tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="confirmPin">{t.auth.confirmPinLabel}</Label>
          <Input
            id="confirmPin"
            type="password"
            inputMode="numeric"
            pattern="\d{4,6}"
            required
            autoComplete="off"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            className="h-14 text-lg tabular-nums"
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
