import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { getDictionary, resolveLocale } from "@/lib/i18n";
import ResetPasswordForm from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = getDictionary(await resolveLocale());

  if (!token) {
    return (
      <AuthCard className="flex flex-col gap-4">
        <p className="text-body-airbnb text-muted-foreground">{t.auth.resetLinkMissing}</p>
        <Link href="/forgot-password" className="text-sm underline underline-offset-2">
          {t.auth.requestNewLink}
        </Link>
        <Link href="/login" className="text-sm underline underline-offset-2">
          {t.auth.backToLogin}
        </Link>
      </AuthCard>
    );
  }

  return <ResetPasswordForm token={token} />;
}
