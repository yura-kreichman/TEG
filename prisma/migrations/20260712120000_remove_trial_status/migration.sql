-- Убираем "trialing" из SubscriptionStatus и Tenant.trialEndsAt — триала как
-- отдельного time-boxed статуса в модели пакетов нет, ограниченный бесплатный
-- доступ даёт Free-пакет (Package с priceMonthly=0), см. схему/prisma/schema.prisma.
BEGIN;

CREATE TYPE "SubscriptionStatus_new" AS ENUM ('active', 'paused', 'suspended', 'expired');
ALTER TABLE "Tenant" ALTER COLUMN "subscriptionStatus" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "subscriptionStatus" TYPE "SubscriptionStatus_new" USING ("subscriptionStatus"::text::"SubscriptionStatus_new");
ALTER TABLE "Tenant" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'active';
DROP TYPE "SubscriptionStatus";
ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";

ALTER TABLE "Tenant" DROP COLUMN "trialEndsAt";

COMMIT;
