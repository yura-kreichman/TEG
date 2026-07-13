import { AuthCard } from "@/components/auth-card";
import { getDictionary, resolveLocale } from "@/lib/i18n";
import ActivateDeviceClient from "./activate-device-client";

export default async function ActivateDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = getDictionary(await resolveLocale());

  if (!token) {
    return (
      <AuthCard>
        <p className="text-body-airbnb text-muted-foreground">{t.auth.activateLinkMissing}</p>
      </AuthCard>
    );
  }

  return <ActivateDeviceClient token={token} />;
}
