import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import type { TUpdatePricing } from "./platform.pricing.validation.js";

// =====================================================
// PREMIUM FEATURE CODES
// =====================================================

const PREMIUM_FEATURE_CODES = [
  "BRANCH_STORE",
  "GROUP_BUYING",
  "HAIRSTYLIST",
  "WALLET",
  "REVIEWS",
] as const;

// =====================================================
// 1. GET PLATFORM PRICING
// =====================================================

export const getPlatformPricing = async () => {
  const [plan, addons] = await Promise.all([
    prisma.subscriptionPlan.findUnique({
      where: {
        code: "STANDARD",
      },
    }),

    prisma.addonFeature.findMany({
      where: {
        code: {
          in: [...PREMIUM_FEATURE_CODES],
        },
      },

      orderBy: {
        code: "asc",
      },
    }),
  ]);

  if (!plan) {
    throw new AppError("STANDARD subscription plan not found", 404);
  }

  return {
    plan: {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      price: plan.price.toString(),
      currency: plan.currency,
      isActive: plan.isActive,
    },

    addons: addons.map((addon) => ({
      id: addon.id,
      code: addon.code,
      name: addon.name,
      description: addon.description,
      price: addon.price.toString(),
      currency: addon.currency,
      isActive: addon.isActive,
    })),
  };
};

// =====================================================
// 2. UPDATE STANDARD PLAN PRICE
// =====================================================

export const updateStandardPlanPrice = async (payload: TUpdatePricing) => {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: {
      code: "STANDARD",
    },
  });

  if (!plan) {
    throw new AppError("STANDARD subscription plan not found", 404);
  }

  const updatedPlan = await prisma.subscriptionPlan.update({
    where: {
      id: plan.id,
    },

    data: {
      price: payload.price,
    },
  });

  return {
    id: updatedPlan.id,
    code: updatedPlan.code,
    name: updatedPlan.name,
    price: updatedPlan.price.toString(),
    currency: updatedPlan.currency,
    isActive: updatedPlan.isActive,
  };
};

// =====================================================
// 3. UPDATE PREMIUM ADD-ON PRICE
// =====================================================

export const updatePremiumAddonPrice = async (
  code: string,
  payload: TUpdatePricing,
) => {
  if (
    !PREMIUM_FEATURE_CODES.includes(
      code as (typeof PREMIUM_FEATURE_CODES)[number],
    )
  ) {
    throw new AppError("Invalid premium feature code", 400);
  }

  const addon = await prisma.addonFeature.findUnique({
    where: {
      code,
    },
  });

  if (!addon) {
    throw new AppError("Premium feature not found", 404);
  }

  const updatedAddon = await prisma.addonFeature.update({
    where: {
      id: addon.id,
    },

    data: {
      price: payload.price,
    },
  });

  return {
    id: updatedAddon.id,
    code: updatedAddon.code,
    name: updatedAddon.name,
    price: updatedAddon.price.toString(),
    currency: updatedAddon.currency,
    isActive: updatedAddon.isActive,
  };
};
