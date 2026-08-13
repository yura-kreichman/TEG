-- Индексы под реально горячие запросы (аудит производительности 2026-08-13).
--
-- Выбраны не по списку «все FK без индекса» (таких 74, и большинство холодные),
-- а по конкретным местам в коде, которые выполняются на каждом открытии экрана:
--
--  * MoneyOperation(tenantId, occurredAt) — reports/home-summary, главный экран
--    владельца: прибыль за день по тенанту. Существующий [tenantId] отбирает
--    все операции тенанта за всё время, и дата отсекается уже после выборки.
--
--  * MoneyOperation(zoneId, occurredAt) — lib/zone-balance.ts читает операции по
--    списку зон на каждом открытии экрана оператора. Индекса с ведущим zoneId
--    не было вообще: [resultsSubmissionId, zoneId] для такого запроса не годится.
--
--  * Shift(pointId, isOpen) — «есть ли открытая смена на точке», проверяется при
--    сдаче итогов и в сводках. Был только [operatorId, startAt].
--
-- CONCURRENTLY не используется намеренно: таблицы сейчас в тысячи строк (вся
-- база 15 МБ), блокировка на построение измеряется миллисекундами, а
-- CONCURRENTLY нельзя выполнить внутри транзакции, в которую Prisma заворачивает
-- миграцию. Когда таблицы вырастут настолько, что это станет важно, такие
-- индексы нужно будет добавлять отдельным ручным шагом вне миграции.
CREATE INDEX "MoneyOperation_tenantId_occurredAt_idx" ON "MoneyOperation"("tenantId", "occurredAt");
CREATE INDEX "MoneyOperation_zoneId_occurredAt_idx" ON "MoneyOperation"("zoneId", "occurredAt");
CREATE INDEX "Shift_pointId_isOpen_idx" ON "Shift"("pointId", "isOpen");
