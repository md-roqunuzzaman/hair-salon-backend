-- SQLite requires a table rebuild to change a column default. The migration
-- runner wraps this entire copy/swap plus ledger insertion in transactionSync.
-- No table references BrandEmailSetting; its Brand parent FK remains enforced.
CREATE TABLE "_new_BrandEmailSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "brandId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "fromName" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "smtpHost" TEXT,
  "smtpPort" INTEGER,
  "smtpSecure" BOOLEAN,
  "smtpUsername" TEXT,
  "encryptedCredential" TEXT,
  "oauthDataEncrypted" TEXT,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "configurationVersion" INTEGER NOT NULL DEFAULT 1,
  "providerData" JSONB,
  "lastTestAt" DATETIME,
  "lastErrorCode" TEXT,
  CONSTRAINT "BrandEmailSetting_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "_new_BrandEmailSetting" (
  "id","brandId","provider","fromName","fromEmail","smtpHost","smtpPort","smtpSecure","smtpUsername","encryptedCredential","oauthDataEncrypted","isEnabled","isVerified","createdAt","updatedAt","configurationVersion","providerData","lastTestAt","lastErrorCode"
) SELECT
  "id","brandId","provider","fromName","fromEmail","smtpHost","smtpPort","smtpSecure","smtpUsername","encryptedCredential","oauthDataEncrypted","isEnabled","isVerified","createdAt","updatedAt","configurationVersion","providerData","lastTestAt","lastErrorCode"
FROM "BrandEmailSetting";
DROP TABLE "BrandEmailSetting";
ALTER TABLE "_new_BrandEmailSetting" RENAME TO "BrandEmailSetting";
CREATE UNIQUE INDEX "BrandEmailSetting_brandId_key" ON "BrandEmailSetting"("brandId");
