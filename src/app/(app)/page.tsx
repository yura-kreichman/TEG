import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { getActivatedDevice } from "@/lib/operator-auth";
import { OwnerShell } from "@/components/owner-shell";
import { OnboardingWelcomeSheet } from "@/components/onboarding-welcome-sheet";
import { WelcomeCard, OwnerDashboardCard } from "./dashboard-home";

export default async function Home() {
  const userId = await getSessionUserId();
  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, pinHash: true, createdAt: true, role: true, tenant: true },
      })
    : null;

  // Устройство точки проверяем ТОЛЬКО когда нет реальной сессии Владельца —
  // реальный баг, найден пользователем 2026-07-29 (фича "Войти как Владелец"
  // на экране входа Сотрудника, см. operator/login/page.tsx): раньше эта
  // проверка шла ДО сессии и безусловно редиректила на /operator, даже если
  // Владелец только что успешно залогинился ПИНом прямо на этом устройстве —
  // "/" после успешного входа тут же отбрасывала обратно на /operator/login
  // (там ещё нет операторской сессии), словно вход и не сработал. Сам
  // прод-баг 2026-07-14 (установленный на телефон значок PWA открывает "/" на
  // киоске без сессии Владельца — раньше показывало приветственный экран
  // регистрации вместо /operator) по-прежнему покрыт: просто теперь
  // валидная сессия Владельца имеет приоритет НАД фактом активации
  // устройства, а не наоборот.
  if (!user || user.role !== "owner") {
    const device = await getActivatedDevice();
    if (device) {
      redirect("/operator");
    }
    return <WelcomeCard />;
  }

  // Приветственная шторка с демо-данными (запрос пользователя 2026-07-27) —
  // пока у тенанта нет ни одной точки И предложение ещё не показывали/не
  // отклоняли (onboardingDismissedAt всё ещё null). tenantId явно
  // проверяется (не просто ?.) — иначе undefined в where сосчитал бы точки
  // ВСЕХ тенантов разом, а не только этого.
  const showOnboarding =
    Boolean(user.tenant) &&
    !user.tenant!.onboardingDismissedAt &&
    (await prisma.point.count({ where: { tenantId: user.tenant!.id } })) === 0;

  return (
    <OwnerShell>
      <OwnerDashboardCard
        email={user.email}
        tenantName={user.tenant?.name ?? null}
        tenantLogoUrl={user.tenant?.logoUrl ?? null}
        hasPin={Boolean(user.pinHash)}
      />
      <OnboardingWelcomeSheet initialOpen={showOnboarding} />
    </OwnerShell>
  );
}
