-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BrandSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "basePrice" BIGINT NOT NULL DEFAULT 0,
    "addonsPrice" BIGINT NOT NULL DEFAULT 0,
    "totalPrice" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandSubscription_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrandSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AddonFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BrandSubscriptionAddon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandSubscriptionAddon_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BrandSubscription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrandSubscriptionAddon_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "AddonFeature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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

CREATE TRIGGER "money_SubscriptionPlan_price_INSERT" BEFORE INSERT ON "SubscriptionPlan" WHEN NEW."price" IS NOT NULL AND (typeof(NEW."price") != 'integer' OR abs(NEW."price") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_SubscriptionPlan_price_UPDATE" BEFORE UPDATE ON "SubscriptionPlan" WHEN NEW."price" IS NOT NULL AND (typeof(NEW."price") != 'integer' OR abs(NEW."price") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_AddonFeature_price_INSERT" BEFORE INSERT ON "AddonFeature" WHEN NEW."price" IS NOT NULL AND (typeof(NEW."price") != 'integer' OR abs(NEW."price") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_AddonFeature_price_UPDATE" BEFORE UPDATE ON "AddonFeature" WHEN NEW."price" IS NOT NULL AND (typeof(NEW."price") != 'integer' OR abs(NEW."price") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_BrandSubscription_basePrice_INSERT" BEFORE INSERT ON "BrandSubscription" WHEN NEW."basePrice" IS NOT NULL AND (typeof(NEW."basePrice") != 'integer' OR abs(NEW."basePrice") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_BrandSubscription_basePrice_UPDATE" BEFORE UPDATE ON "BrandSubscription" WHEN NEW."basePrice" IS NOT NULL AND (typeof(NEW."basePrice") != 'integer' OR abs(NEW."basePrice") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_BrandSubscription_addonsPrice_INSERT" BEFORE INSERT ON "BrandSubscription" WHEN NEW."addonsPrice" IS NOT NULL AND (typeof(NEW."addonsPrice") != 'integer' OR abs(NEW."addonsPrice") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_BrandSubscription_addonsPrice_UPDATE" BEFORE UPDATE ON "BrandSubscription" WHEN NEW."addonsPrice" IS NOT NULL AND (typeof(NEW."addonsPrice") != 'integer' OR abs(NEW."addonsPrice") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_BrandSubscription_totalPrice_INSERT" BEFORE INSERT ON "BrandSubscription" WHEN NEW."totalPrice" IS NOT NULL AND (typeof(NEW."totalPrice") != 'integer' OR abs(NEW."totalPrice") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;

CREATE TRIGGER "money_BrandSubscription_totalPrice_UPDATE" BEFORE UPDATE ON "BrandSubscription" WHEN NEW."totalPrice" IS NOT NULL AND (typeof(NEW."totalPrice") != 'integer' OR abs(NEW."totalPrice") > 999999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
