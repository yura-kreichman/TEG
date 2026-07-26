-- Ширина рулона/тип принтера переезжает с тенанта на конкретное устройство
-- (Оператор) — печать физически привязана к устройству, не к бизнесу
-- целиком (см. комментарий у PointDevice.receiptPaperWidth в schema.prisma).
-- Владелец получает свою версию настройки в localStorage браузера (не в БД,
-- он не привязан к PointDevice), см. use-print.ts.
ALTER TABLE "Tenant" DROP COLUMN "receiptPaperWidthMm";
ALTER TABLE "PointDevice" ADD COLUMN "receiptPaperWidth" TEXT NOT NULL DEFAULT '58';
