import { Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

const PREMIUM_FEATURE_CODES = [
  "BRANCH_STORE",
  "GROUP_BUYING",
  "HAIRSTYLIST",
  "WALLET",
  "REVIEWS",
] as const;

type PremiumFeatureCode = (typeof PREMIUM_FEATURE_CODES)[number];

type CalculateSubscriptionPriceInput = {
  planCode: string;
  premiumFeatures?: PremiumFeatureCode[];
};

export const calculateSubscriptionPrice = async ({
  planCode,
  premiumFeatures = [],
}: CalculateSubscriptionPriceInput) => {
  // ============================================
  // 1. VALIDATE PLAN CODE
  // ============================================

  if (planCode !== "STANDARD") {
    throw new AppError("Only STANDARD subscription plan is supported", 400);
  }

  // ============================================
  // 2. VALIDATE PREMIUM FEATURE CODES
  // ============================================

  const uniqueFeatures = [...new Set(premiumFeatures)];

  const invalidFeatures = uniqueFeatures.filter(
    (code) => !PREMIUM_FEATURE_CODES.includes(code as PremiumFeatureCode),
  );

  if (invalidFeatures.length > 0) {
    throw new AppError(
      `Invalid premium features: ${invalidFeatures.join(", ")}`,
      400,
    );
  }

  // ============================================
  // 3. FETCH STANDARD PLAN
  // ============================================

  const plan = await prisma.subscriptionPlan.findUnique({
    where: {
      code: planCode,
    },
  });

  if (!plan || !plan.isActive) {
    throw new AppError("STANDARD subscription plan is unavailable", 404);
  }

  // ============================================
  // 4. FETCH SELECTED ADD-ONS
  // ============================================

  const addons = await prisma.addonFeature.findMany({
    where: {
      code: {
        in: uniqueFeatures,
      },
      isActive: true,
    },
  });

  if (addons.length !== uniqueFeatures.length) {
    throw new AppError("One or more premium features are unavailable", 400);
  }

  // ============================================
  // 5. VALIDATE CURRENCY
  // ============================================

  const currencyMismatch = addons.some(
    (addon) => addon.currency !== plan.currency,
  );

  if (currencyMismatch) {
    throw new AppError(
      "Premium feature currency does not match subscription currency",
      400,
    );
  }

  // ============================================
  // 6. CALCULATE BASE PRICE
  // ============================================

  const basePrice = new Prisma.Decimal(plan.price);

  // ============================================
  // 7. CALCULATE ADD-ONS PRICE
  // ============================================

  const addonsPrice = addons.reduce(
    (total, addon) => total.plus(addon.price),
    new Prisma.Decimal(0),
  );

  // ============================================
  // 8. CALCULATE TOTAL PRICE
  // ============================================

  const totalPrice = basePrice.plus(addonsPrice);

  // ============================================
  // 9. RETURN PRICE BREAKDOWN
  // ============================================

  return {
    planId: plan.id,
    planCode: plan.code,
    currency: plan.currency,

    basePrice,
    addonsPrice,
    totalPrice,

    premiumFeatures: addons.map((addon) => ({
      id: addon.id,
      code: addon.code,
      name: addon.name,
      price: addon.price,
    })),

    addonIds: addons.map((addon) => addon.id),
  };
};
