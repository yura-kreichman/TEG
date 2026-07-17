-- Тумблер Push-уведомления об инкассации оператора (запрос пользователя 2026-07-17)
ALTER TABLE "PushNotificationSettings" ADD COLUMN "collection" BOOLEAN NOT NULL DEFAULT true;
