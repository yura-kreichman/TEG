import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getActivatedDevice } from "@/lib/operator-auth";
import { OwnerShell } from "@/components/owner-shell";
import { WelcomeCard, OwnerDashboardCard } from "./dashboard-home";

export default async function Home() {
  // "/" проверял только сессию Владельца — на активированном устройстве
  // точки без Owner-сессии (обычный случай для кассы-киоска) это всегда
  // показывало приветственный экран регистрации, даже если Оператор уже
  // залогинен в /operator. Реальный прод-баг (2026-07-14): установленный
  // на телефон значок открывает именно "/" (WebAPK может закэшировать
  // start_url на момент установки и не обновлять его сразу же), поэтому
  // сама "/" обязана перенаправлять по факту активации устройства — так
  // же, как это уже делает src/app/manifest.ts для start_url.
  const device = await getActivatedDevice();
  if (device) {
    redirect("/operator");
  }

  const userId = await getSessionUserId();
  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, pinHash: true, createdAt: true, role: true, tenant: true },
      })
    : null;

  if (!user || user.role !== "owner") {
    return <WelcomeCard />;
  }

  return (
    <OwnerShell>
      <OwnerDashboardCard
        email={user.email}
        tenantName={user.tenant?.name ?? null}
        tenantLogoUrl={user.tenant?.logoUrl ?? null}
        hasPin={Boolean(user.pinHash)}
      />
    </OwnerShell>
  );
}
