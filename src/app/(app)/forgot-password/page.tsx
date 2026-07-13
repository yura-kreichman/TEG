"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthCard } from "@/components/auth-card";
import { PressableScale } from "@/components/motion/pressable-scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/i18n-provider";

export default function ForgotPasswordPage() {
  const t = useI18n();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setDevResetLink(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Не удалось отправить ссылку для сброса пароля");
        return;
      }

      setMessage(data.message);
      if (data.devResetLink) setDevResetLink(data.devResetLink);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-screen-title">{t.auth.forgotTitle}</h1>
          <p className="mt-1 text-body-airbnb text-muted-foreground">{t.auth.forgotHint}</p>
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

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-success">{message}</p>}

        {devResetLink && (
          <div className="rounded-control border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
            {t.auth.devResetNotice}
            <br />
            <a href={devResetLink} className="break-all underline">
              {devResetLink}
            </a>
          </div>
        )}

        <PressableScale>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? t.auth.sendingLink : t.auth.sendLinkButton}
          </Button>
        </PressableScale>

        <p className="text-center text-body-airbnb text-muted-foreground">
          {t.auth.rememberedPassword}{" "}
          <Link href="/login" className="underline underline-offset-2">
            {t.auth.loginLink}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
