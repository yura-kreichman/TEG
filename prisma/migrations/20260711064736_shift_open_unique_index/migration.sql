-- Не более одной открытой смены (endAt IS NULL) на оператора — защита от
-- двойного check-in (docs/spec/05-work-time.md, "АВТО"). Частичный уникальный
-- индекс не выражается в schema.prisma, поэтому здесь — сырой SQL.
CREATE UNIQUE INDEX "Shift_operatorId_open_unique" ON "Shift"("operatorId") WHERE "endAt" IS NULL;
