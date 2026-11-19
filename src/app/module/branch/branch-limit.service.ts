import { Prisma } from "../../../../generated/prisma/client.js";

import { featureLicenseConfig } from "../../config/feature-license.config.js";
import { AppError } from "../../utils/app-error.js";
import { isFeatureAvailable } from "../../utils/featureLicense.js";

// =====================================================
// BRANCH STORE LICENSE LIMIT
// =====================================================
//
// BRANCH_STORE ACTIVE:
//   Maximum branches = configured branchLimit
//
// BRANCH_STORE DISABLED / EXPIRED:
//   Maximum branches = 1
//
// All existing branches count toward the limit,
// regardless of ACTIVE / INACTIVE status.
//
// =====================================================

const SINGLE_BRANCH_LIMIT = 1;

// =====================================================
// GET EFFECTIVE BRANCH LIMIT
// =====================================================

export const getEffectiveBranchLimit = (): number => {
  // Disabled, expired, or globally unavailable:
  // Single Branch Mode.
  if (!isFeatureAvailable("BRANCH_STORE")) {
    return SINGLE_BRANCH_LIMIT;
  }

  const configuredLimit =
    featureLicenseConfig.features.BRANCH_STORE.branchLimit;

  // Fail closed on invalid configuration.
  if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1) {
    return SINGLE_BRANCH_LIMIT;
  }

  return configuredLimit;
};

// =====================================================
// ASSERT BRANCH CREATION ALLOWED
// =====================================================

export const assertCanCreateBranch = async (
  brandId: string,
  tx: Prisma.TransactionClient,
): Promise<void> => {
  // ===================================================
  // 1. VALIDATE BRAND ID
  // ===================================================

  if (!brandId?.trim()) {
    throw new AppError("Brand ID is required", 400);
  }

  // ===================================================
  // 2. RESOLVE LICENSE LIMIT
  // ===================================================

  const branchLimit = getEffectiveBranchLimit();

  // ===================================================
  // 3. COUNT EXISTING BRANCHES
  // ===================================================

  const currentBranchCount = await tx.branch.count({
    where: {
      brandId,
    },
  });

  // ===================================================
  // 4. ENFORCE BRANCH LIMIT
  // ===================================================

  if (currentBranchCount >= branchLimit) {
    throw new AppError(
      `Branch limit reached. Maximum ${branchLimit} ${
        branchLimit === 1 ? "branch" : "branches"
      } allowed.`,
      403,
    );
  }
};
