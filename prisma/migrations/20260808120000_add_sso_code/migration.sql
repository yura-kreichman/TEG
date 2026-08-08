-- Одноразовые коды единого входа RentOS -> rentos365.app (см. комментарий у
-- модели SsoCode в schema.prisma). Таблица, а не самоподписанный токен, потому
-- что код обязан гаситься после первого обмена.
CREATE TABLE "SsoCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoCode_codeHash_key" ON "SsoCode"("codeHash");
CREATE INDEX "SsoCode_expiresAt_idx" ON "SsoCode"("expiresAt");

ALTER TABLE "SsoCode" ADD CONSTRAINT "SsoCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
