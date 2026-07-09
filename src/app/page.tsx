import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { OwnerShell } from "@/components/owner-shell";
import { WelcomeCard, OwnerDashboardCard } from "./dashboard-home";

export default async function Home() {
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
