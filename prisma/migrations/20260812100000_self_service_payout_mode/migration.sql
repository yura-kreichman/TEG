-- Что Сотруднику разрешено вносить самому при завершении смены
-- (docs/spec/05-work-time.md, запрос пользователя 2026-08-12).
-- Режим на весь тенант: 'cash' | 'forbidden' | 'accrual' — см. комментарий у
-- поля в schema.prisma. DEFAULT 'cash' = сегодняшнее поведение, существующие
-- тенанты ничего не замечают.
ALTER TABLE "Tenant" ADD COLUMN "selfServicePayoutMode" TEXT NOT NULL DEFAULT 'cash';

-- Персональный запрет поверх тенантного режима: только запрещает, разрешить
-- сверх тенанта не может. DEFAULT true — существующие сотрудники сохраняют
-- своё поведение, владелец выключает выборочно.
ALTER TABLE "Operator" ADD COLUMN "selfServicePayoutAllowed" BOOLEAN NOT NULL DEFAULT true;
