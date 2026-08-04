-- Видит ли сотрудник "Разницу" живьём при вводе кассы (см. комментарий у поля
-- в schema.prisma). Новые сотрудники — слепой ввод (DEFAULT false).
ALTER TABLE "Operator" ADD COLUMN "showDifferenceOnSubmit" BOOLEAN NOT NULL DEFAULT false;

-- Существующим проставляем true: до этой миграции разницу видели ВСЕ и всегда,
-- и молча менять поведение работающих точек нельзя — владелец сам решит, кому
-- переключить на слепой ввод.
UPDATE "Operator" SET "showDifferenceOnSubmit" = true;
