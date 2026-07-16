-- AlterTable
ALTER TABLE "PushNotificationSettings" ADD COLUMN     "instructionAck" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shiftCheckin" BOOLEAN NOT NULL DEFAULT true;
