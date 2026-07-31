-- AddForeignKey
ALTER TABLE "ResultsSubmission" ADD CONSTRAINT "ResultsSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
