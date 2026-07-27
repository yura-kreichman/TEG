-- Блокировка по попыткам подбора пароля (Owner + Super Admin, оба через
-- User.passwordHash) — аудит 2026-07-27, второй раунд: единственной защитой
-- была in-memory rate-limit по IP, без предела на аккаунт и без пережития
-- рестарта контейнера. Тот же паттерн полей, что уже есть у ПИНа
-- (failedPinAttempts/pinLockedUntil).
ALTER TABLE "User" ADD COLUMN "failedPasswordAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "passwordLockedUntil" TIMESTAMP(3);
