-- Grandfather only customers present at upgrade; future customers require OTP.
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
UPDATE "User" SET "emailVerified" = true WHERE "role" = 'CUSTOMER';
