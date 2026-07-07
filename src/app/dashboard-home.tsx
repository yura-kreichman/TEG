"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { PressableScale } from "@/components/motion/pressable-scale";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { SpringCard } from "@/components/spring-card";
import { cn } from "@/lib/utils";
import LogoutButton from "./logout-button";

export function WelcomeCard() {
  const t = useI18n();

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm">
        <SpringCard>
          <StaggerList className="flex flex-col gap-4">
            <StaggerItem>
              <h1 className="text-screen-title">{t.home.welcomeTitle}</h1>
              <p className="mt-1 text-body-airbnb text-muted-foreground">{t.home.welcomeHint}</p>
            </StaggerItem>
            <StaggerItem>
              <PressableScale>
                <Link href="/login" className={cn(buttonVariants(), "w-full")}>
                  {t.home.login}
                </Link>
              </PressableScale>
            </StaggerItem>
            <StaggerItem>
              <Link
                href="/register"
                className="block text-center text-body-airbnb underline underline-offset-2"
              >
                {t.home.createAccount}
              </Link>
            </StaggerItem>
          </StaggerList>
        </SpringCard>
      </div>
    </div>
  );
}

export function OwnerDashboardCard({
  email,
  tenantName,
  hasPin,
}: {
  email: string;
  tenantName: string | null;
  hasPin: boolean;
}) {
  const t = useI18n();

  return (
    <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
      <div className="w-full max-w-md">
        <SpringCard>
          <StaggerList className="flex flex-col gap-4">
            <StaggerItem>
              <h1 className="text-screen-title">{t.home.loggedInTitle}</h1>
              <p className="mt-1 text-caption-airbnb">{email}</p>
              {tenantName && <p className="text-caption-airbnb">{tenantName}</p>}
            </StaggerItem>

            {!hasPin && (
              <StaggerItem>
                <div className="rounded-control border border-warning/40 bg-warning/10 p-3 text-body-airbnb text-foreground">
                  {t.home.pinNotSet}{" "}
                  <Link href="/set-pin" className="underline underline-offset-2">
                    {t.home.setPinNow}
                  </Link>
                </div>
              </StaggerItem>
            )}

            {hasPin && (
              <StaggerItem>
                <Link href="/set-pin" className="text-body-airbnb underline underline-offset-2">
                  {t.home.changePin}
                </Link>
              </StaggerItem>
            )}

            <StaggerItem>
              <PressableScale className="w-fit">
                <LogoutButton />
              </PressableScale>
            </StaggerItem>
          </StaggerList>
        </SpringCard>
      </div>
    </div>
  );
}
