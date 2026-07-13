"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

type Mode = "pin" | "password";
type DeviceStatus = "checking" | "known" | "unknown";

export default function LoginPage() {
  const router = useRouter();
  const t = useI18n();
  const [mode, setMode] = useState<Mode>("pin");

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>("checking");
  const [deviceEmail, setDeviceEmail] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pinJustSet, setPinJustSet] = useState(false);

  // One-time sync from browser-only storage on mount; must run post-hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetch("/api/auth/owner-device")
      .then((res) => res.json())
      .then((data) => {
        setDeviceEmail(data.email);
        setDeviceStatus(data.email ? "known" : "unknown");
      });

    if (window.sessionStorage.getItem("teg:pinJustSet")) {
      setPinJustSet(true);
      window.sessionStorage.removeItem("teg:pinJustSet");
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handlePinSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось войти");
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось войти");
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleNotYou() {
    await fetch("/api/auth/forget-owner-device", { method: "POST" });
    setDeviceEmail(null);
    setDeviceStatus("unknown");
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPin("");
  }

  return (
    <AuthCard className="flex flex-col gap-4">
      <h1 className="text-screen-title">{t.auth.loginTitle}</h1>

      {pinJustSet && <p className="text-body-airbnb text-success">{t.auth.pinJustSet}</p>}

      <div className="flex rounded-control border border-border p-1 text-sm">
        <button
          type="button"
          onClick={() => switchMode("pin")}
          className={cn(
            "flex-1 rounded-control px-3 py-1.5 transition-colors",
            mode === "pin" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          )}
        >
          {t.auth.tabPin}
        </button>
        <button
          type="button"
          onClick={() => switchMode("password")}
          className={cn(
            "flex-1 rounded-control px-3 py-1.5 transition-colors",
            mode === "password" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          )}
        >
          {t.auth.tabPassword}
        </button>
      </div>

      {mode === "pin" ? (
        deviceStatus === "checking" ? null : deviceStatus === "unknown" ? (
          <div className="flex flex-col gap-3">
            <p className="text-body-airbnb text-muted-foreground">{t.auth.deviceUnknownHint}</p>
            <PressableScale>
              <Button
                type="button"
                onClick={() => switchMode("password")}
                className="h-14 w-full text-base font-bold"
              >
                {t.auth.loginWithPassword}
              </Button>
            </PressableScale>
          </div>
        ) : (
          <form onSubmit={handlePinSubmit} className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-control border border-border bg-muted/50 px-3 py-2 text-sm">
              <span>
                {t.auth.loggedInAs} {deviceEmail}
              </span>
              <button type="button" onClick={handleNotYou} className="text-xs underline underline-offset-2">
                {t.auth.notYou}
              </button>
            </div>

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
                className="h-14 text-lg tabular-nums"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <PressableScale>
              <Button type="submit" disabled={loading} className="h-14 w-full text-base font-bold">
                {loading ? t.auth.loggingIn : t.auth.loginButton}
              </Button>
            </PressableScale>
          </form>
        )
      ) : (
        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="email">{t.auth.emailLabel}</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="password">{t.auth.passwordLabel}</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <PressableScale>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t.auth.loggingIn : t.auth.loginButton}
            </Button>
          </PressableScale>

          <Link href="/forgot-password" className="text-center text-sm underline underline-offset-2">
            {t.auth.forgotPassword}
          </Link>
        </form>
      )}

      <p className="text-center text-body-airbnb text-muted-foreground">
        {t.auth.noAccount}{" "}
        <Link href="/register" className="underline underline-offset-2">
          {t.auth.registerLink}
        </Link>
      </p>
    </AuthCard>
  );
}
