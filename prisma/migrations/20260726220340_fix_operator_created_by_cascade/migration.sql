-- DropForeignKey
ALTER TABLE "Operator" DROP CONSTRAINT "Operator_createdByUserId_fkey";

-- AddForeignKey
ALTER TABLE "Operator" ADD CONSTRAINT "Operator_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
