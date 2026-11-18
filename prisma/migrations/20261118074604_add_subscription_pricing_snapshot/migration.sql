-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandSubscription" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "basePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "addonsPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddonFeature" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddonFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandSubscriptionAddon" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSubscriptionAddon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "BrandSubscription_brandId_status_idx" ON "BrandSubscription"("brandId", "status");

-- CreateIndex
CREATE INDEX "BrandSubscription_startAt_endAt_idx" ON "BrandSubscription"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "AddonFeature_code_key" ON "AddonFeature"("code");

-- CreateIndex
CREATE INDEX "BrandSubscriptionAddon_addonId_idx" ON "BrandSubscriptionAddon"("addonId");

-- CreateIndex
CREATE INDEX "BrandSubscriptionAddon_startAt_endAt_idx" ON "BrandSubscriptionAddon"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSubscriptionAddon_subscriptionId_addonId_key" ON "BrandSubscriptionAddon"("subscriptionId", "addonId");

-- AddForeignKey
ALTER TABLE "BrandSubscription" ADD CONSTRAINT "BrandSubscription_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSubscription" ADD CONSTRAINT "BrandSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSubscriptionAddon" ADD CONSTRAINT "BrandSubscriptionAddon_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BrandSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSubscriptionAddon" ADD CONSTRAINT "BrandSubscriptionAddon_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "AddonFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
