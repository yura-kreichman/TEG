"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";

export default function RegisterPage() {
  const router = useRouter();
  const t = useI18n();
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantName, email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось зарегистрироваться");
        return;
      }

      router.push("/set-pin");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-screen-title">{t.auth.registerTitle}</h1>
          <p className="mt-1 text-body-airbnb text-muted-foreground">{t.auth.registerHint}</p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="tenantName">{t.auth.companyNameLabel}</Label>
          <Input
            id="tenantName"
            type="text"
            required
            autoComplete="organization"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
          />
        </div>

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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-caption-airbnb">{t.auth.minPasswordHint}</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <PressableScale>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? t.auth.creatingAccount : t.auth.registerButton}
          </Button>
        </PressableScale>

        <p className="text-center text-body-airbnb text-muted-foreground">
          {t.auth.haveAccount}{" "}
          <Link href="/login" className="underline underline-offset-2">
            {t.auth.loginLink}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
