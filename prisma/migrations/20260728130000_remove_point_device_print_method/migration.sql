-- Убираем PointDevice.printMethod — фича прямой Bluetooth-печати не
-- заработала на реальном устройстве (2026-07-28), убрана целиком.
ALTER TABLE "PointDevice" DROP COLUMN "printMethod";
