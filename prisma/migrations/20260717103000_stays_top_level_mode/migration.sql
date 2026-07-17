-- "Прибывания" — самостоятельный accountingMode="stays", не суб-режим
-- launches (решение пользователя 2026-07-17, пересмотр решения от 2026-07-16).
-- Переносим существующие зоны launchMode="game_room" на accountingMode="stays"
-- перед удалением поля, чтобы не потерять их фактический режим учёта.
UPDATE "Zone" SET "accountingMode" = 'stays' WHERE "launchMode" = 'game_room';

ALTER TABLE "Zone" DROP COLUMN "launchMode";
