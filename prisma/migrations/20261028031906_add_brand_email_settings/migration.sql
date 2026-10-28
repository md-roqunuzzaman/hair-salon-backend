-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'MICROSOFT_365', 'QQ', 'NETEASE_163', 'CUSTOM_SMTP', 'RESEND');

-- CreateTable
CREATE TABLE "BrandEmailSetting" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN,
    "smtpUsername" TEXT,
    "encryptedCredential" TEXT,
    "oauthDataEncrypted" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandEmailSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandEmailSetting_brandId_key" ON "BrandEmailSetting"("brandId");

-- AddForeignKey
ALTER TABLE "BrandEmailSetting" ADD CONSTRAINT "BrandEmailSetting_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
