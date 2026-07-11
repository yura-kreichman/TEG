-- Переносим "не больше одной открытой смены на оператора" с endAt на isOpen —
-- фильтрация nullable DateTime по null сломана в этой версии Prisma Client
-- (см. комментарий у Shift.isOpen в schema.prisma), приложение теперь читает
-- именно isOpen, поэтому и защитный индекс должен стоять на нём же.
DROP INDEX "Shift_operatorId_open_unique";
CREATE UNIQUE INDEX "Shift_operatorId_open_unique" ON "Shift"("operatorId") WHERE "isOpen" = true;
