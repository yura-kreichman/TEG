-- Настройки → Система: общий рубильник "печать вообще есть" (будущий
-- модуль печати квитанций, не фискальных чеков).
ALTER TABLE "Tenant" ADD COLUMN "printingEnabled" BOOLEAN NOT NULL DEFAULT false;
