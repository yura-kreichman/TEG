-- Способ печати устройства — "browser" (текущее поведение, дефолт) |
-- "bluetooth" (прямая печать ESC/POS через Web Bluetooth, 2026-07-27,
-- обход стороннего Android Print Service-моста).
ALTER TABLE "PointDevice" ADD COLUMN "printMethod" TEXT NOT NULL DEFAULT 'browser';
