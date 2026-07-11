"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

/**
 * Баннер имперсонации (docs/spec/06-super-admin.md, п.4) — рендерится внутри
 * OwnerShell, поэтому виден на каждом экране кабинета владельца, пока Admin
 * вошёл от его имени. Молчит (не рендерит ничего), если имперсонации нет —
 * обычный владелец не видит даже пустого места.
 */
export function ImpersonationBanner() {
  const router = useRouter();
  const t = useI18n();
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/impersonation")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.impersonating) setTenantName(data.tenantName ?? "");
      });
  }, []);

  if (tenantName === null) return null;

  async function exit() {
    await fetch("/api/auth/exit-impersonation", { method: "POST" });
    router.replace("/admin");
    router.refresh();
  }

  return (
    <div className="flex w-full items-center justify-center gap-2 bg-warning px-3 py-2 text-center text-caption-airbnb font-semibold text-warning-foreground">
      <ShieldAlert className="size-4 shrink-0" />
      <span>
        {t.admin.impersonationBannerPrefix} «{tenantName}»
      </span>
      <button type="button" onClick={exit} className="underline underline-offset-2">
        {t.admin.exitImpersonation}
      </button>
    </div>
  );
}
