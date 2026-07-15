import { prisma } from "@/lib/prisma";
import { getDictionary } from "@/lib/i18n";
import { isLocale } from "@/lib/locales";
import { I18nProvider } from "@/components/i18n-provider";
import InstructionReaderClient from "./instruction-reader-client";

// Публичная страница чтения и подписания (docs/spec/07-instructions.md) —
// без авторизации, лёгкая: RSC-обёртка только разворачивает params (await
// обязателен в этой версии Next), вся логика — в клиентском компоненте.
//
// Язык страницы — язык ТЕНАНТА (уточнение пользователя 2026-07-12), не
// браузера читателя: сам текст инструкции пишет владелец на одном
// конкретном языке (обычный текст, без i18n), поэтому окружающий интерфейс
// (подписи полей, кнопка) должен совпадать с ним, а не расходиться, как
// было при резолве по языку посетителя. Оборачиваем в собственный
// I18nProvider с явным dict тенанта — переопределяет корневой провайдер
// для этого поддерева (React Context берёт ближайшего предка), поэтому
// добавлять "/i" в PRE_AUTH_PATHS (src/proxy.ts) больше не нужно — сессия
// читателя здесь вообще не участвует в выборе языка.
export default async function PublicInstructionPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; instructionSlug: string }>;
}) {
  const { tenantSlug, instructionSlug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { locale: true } });
  const locale = tenant?.locale && isLocale(tenant.locale) ? tenant.locale : "ru";
  const dict = getDictionary(locale);

  return (
    <I18nProvider dict={dict} locale={locale}>
      <InstructionReaderClient tenantSlug={tenantSlug} instructionSlug={instructionSlug} />
    </I18nProvider>
  );
}
