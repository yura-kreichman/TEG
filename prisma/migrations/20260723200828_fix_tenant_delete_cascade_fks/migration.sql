-- Удаление тенанта (Super Admin, docs/spec/06-super-admin.md) падало
-- необработанной ошибкой внешнего ключа на ЛЮБОМ тенанте, хоть раз сдавшем
-- итоги / продавшем билет / провёдшем ревизию Товаров: Operator/Goods
-- удаляются отдельной каскадной цепочкой от Tenant, а эти три FK на них
-- были ON DELETE RESTRICT — Postgres не гарантирует порядок срабатывания
-- независимых каскадов, поэтому строки ResultsSubmission/TicketOrder/
-- GoodsRevisionLine оставались "живыми" в момент удаления Operator/Goods и
-- блокировали его. Найдено и воспроизведено прямым выполнением DELETE на
-- аудите проекта (в транзакции с ROLLBACK, без реальных потерь данных).

-- ResultsSubmission.operator
ALTER TABLE "ResultsSubmission" DROP CONSTRAINT "ResultsSubmission_operatorId_fkey";
ALTER TABLE "ResultsSubmission" ADD CONSTRAINT "ResultsSubmission_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TicketOrder.soldByOperator
ALTER TABLE "TicketOrder" DROP CONSTRAINT "TicketOrder_soldByOperatorId_fkey";
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_soldByOperatorId_fkey"
  FOREIGN KEY ("soldByOperatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GoodsRevisionLine.goods
ALTER TABLE "GoodsRevisionLine" DROP CONSTRAINT "GoodsRevisionLine_goodsId_fkey";
ALTER TABLE "GoodsRevisionLine" ADD CONSTRAINT "GoodsRevisionLine_goodsId_fkey"
  FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
