-- Ширина рулона термопринтера (58/80мм) — нужна явно в @page, "size: auto"
-- в --kiosk-printing не подстраивается под реальный рулон (см. комментарий
-- у поля в schema.prisma).
ALTER TABLE "Tenant" ADD COLUMN "receiptPaperWidthMm" INTEGER NOT NULL DEFAULT 58;
