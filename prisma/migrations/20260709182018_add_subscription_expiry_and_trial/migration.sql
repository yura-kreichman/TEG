-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'trialing';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "subscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);
