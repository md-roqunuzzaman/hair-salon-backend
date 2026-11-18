import { Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

// =====================================================
// PREMIUM FEATURE CODES
// =====================================================

export const PREMIUM_FEATURE_CODES = [
  "BRANCH_STORE",
  "GROUP_BUYING",
  "HAIRSTYLIST",
  "WALLET",
  "REVIEWS",
] as const;

export type PremiumFeatureCode = (typeof PREMIUM_FEATURE_CODES)[number];

const STANDARD_BRANCH_LIMIT = 1;

type DbClient = Prisma.TransactionClient | typeof prisma;

// =====================================================
// 1. GET ACTIVE SUBSCRIPTION
// =====================================================

const getActiveSubscription = async (
  brandId: string,
  db: DbClient = prisma,
) => {
  const now = new Date();

  return db.brandSubscription.findFirst({
    where: {
      brandId,
      status: "ACTIVE",
      startAt: { lte: now },
      endAt: { gt: now },
      plan: {
        is: {
          isActive: true,
        },
      },
    },
    orderBy: [{ startAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      brandId: true,
      addons: {
        where: {
          enabled: true,
          startAt: { lte: now },
          endAt: { gt: now },
          addon: {
            is: {
              isActive: true,
            },
          },
        },
        select: {
          branchLimit: true,
          addon: {
            select: {
              code: true,
            },
          },
        },
      },
    },
  });
};

// =====================================================
// 2. CHECK ACTIVE SUBSCRIPTION
// =====================================================

export const hasActiveSubscription = async (
  brandId: string,
  db: DbClient = prisma,
): Promise<boolean> => {
  const subscription = await getActiveSubscription(brandId, db);

  return subscription !== null;
};

// =====================================================
// 3. CHECK PREMIUM FEATURE ENTITLEMENT
// =====================================================

export const hasPremiumFeature = async (
  brandId: string,
  featureCode: PremiumFeatureCode,
  db: DbClient = prisma,
): Promise<boolean> => {
  const subscription = await getActiveSubscription(brandId, db);

  if (!subscription) {
    return false;
  }

  return subscription.addons.some((item) => item.addon.code === featureCode);
};

// =====================================================
// 4. REQUIRE PREMIUM FEATURE
// =====================================================

export const assertPremiumFeature = async (
  brandId: string,
  featureCode: PremiumFeatureCode,
  db: DbClient = prisma,
): Promise<void> => {
  const enabled = await hasPremiumFeature(brandId, featureCode, db);

  if (!enabled) {
    throw new AppError(
      `${featureCode} premium feature is not enabled for this merchant.`,
      403,
    );
  }
};

// =====================================================
// 5. GET BRANCH LIMIT
// =====================================================

export const getBranchLimit = async (
  brandId: string,
  db: DbClient = prisma,
): Promise<number> => {
  const subscription = await getActiveSubscription(brandId, db);

  if (!subscription) {
    return STANDARD_BRANCH_LIMIT;
  }

  const branchStoreAddon = subscription.addons.find(
    (item) => item.addon.code === "BRANCH_STORE",
  );

  if (!branchStoreAddon) {
    return STANDARD_BRANCH_LIMIT;
  }

  const configuredLimit = branchStoreAddon.branchLimit;

  if (
    configuredLimit === null ||
    !Number.isSafeInteger(configuredLimit) ||
    configuredLimit <= STANDARD_BRANCH_LIMIT
  ) {
    throw new AppError("Invalid BRANCH_STORE branch limit configuration.", 500);
  }

  return configuredLimit;
};

// =====================================================
// 6. VALIDATE BRANCH CREATION LIMIT
// =====================================================

export const assertCanCreateBranch = async (
  brandId: string,
  db: DbClient = prisma,
): Promise<void> => {
  const brand = await db.brand.findUnique({
    where: {
      id: brandId,
    },
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const active = await hasActiveSubscription(brandId, db);

  if (!active) {
    throw new AppError(
      "An active subscription is required to create a branch.",
      403,
    );
  }

  const maxBranches = await getBranchLimit(brandId, db);

  const currentBranchCount = await db.branch.count({
    where: {
      brandId,
    },
  });

  if (currentBranchCount >= maxBranches) {
    throw new AppError(
      `Your subscription allows a maximum of ${maxBranches} branches.`,
      403,
    );
  }
};
