-- Приводим значение режима учёта времени оператора к терминологии
-- docs/spec/05-work-time.md ("РЕЖИМ УЧЁТА ВРЕМЕНИ": manual / auto).
-- Operator.timeTrackingMode остаётся обычным String (как Zone.accountingMode),
-- без Prisma-enum — меняются только уже записанные значения.
UPDATE "Operator" SET "timeTrackingMode" = 'auto' WHERE "timeTrackingMode" = 'checkinout';
