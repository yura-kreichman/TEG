ALTER TABLE "User" ADD COLUMN "login" TEXT;
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
