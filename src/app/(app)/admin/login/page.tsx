"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";

export default function AdminLoginPage() {
  const router = useRouter();
  const t = useI18n();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t.admin.loginError);
        return;
      }
      router.push("/admin");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard className="flex flex-col gap-4">
      <div>
        <h1 className="text-screen-title">{t.admin.loginTitle}</h1>
        <p className="text-caption-airbnb">{t.admin.loginSub}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="login">{t.admin.loginFieldLabel}</Label>
          <Input
            id="login"
            type="text"
            required
            autoFocus
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
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
          <Button type="submit" disabled={loading} className="h-14 w-full text-base font-bold">
            {loading ? t.auth.loggingIn : t.auth.loginButton}
          </Button>
        </PressableScale>
      </form>
    </AuthCard>
  );
}
