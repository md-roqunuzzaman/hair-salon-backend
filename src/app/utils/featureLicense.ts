import { featureLicenseConfig } from "../config/feature-license.config.js";
import { AppError } from "./app-error.js";

// =====================================================
// FEATURE LICENSE TYPES
// =====================================================

export type FeatureCode = keyof typeof featureLicenseConfig.features;

export type FeatureStatus =
  | "ACTIVE"
  | "DISABLED"
  | "EXPIRED"
  | "LICENSE_DISABLED"
  | "LICENSE_EXPIRED"
  | "NOT_STARTED"
  | "INVALID_CONFIG";

type FeatureConfig = {
  enabled: boolean;
  startsAt?: string | null;
  expiresAt: string | null;
  branchLimit?: number;
};

// =====================================================
// DATE PARSER
// =====================================================

const parseDate = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
};

// =====================================================
// GET FEATURE STATUS
// =====================================================

export const getFeatureStatus = (
  feature: FeatureCode,
  now: Date = new Date(),
): FeatureStatus => {
  const license = featureLicenseConfig.license;

  const config: FeatureConfig = featureLicenseConfig.features[feature];

  const currentTime = now.getTime();

  // ===================================================
  // 1. VALIDATE CURRENT TIME
  // ===================================================

  if (!Number.isFinite(currentTime)) {
    return "INVALID_CONFIG";
  }

  // ===================================================
  // 2. CHECK GLOBAL LICENSE
  // ===================================================

  if (!license.enabled) {
    return "LICENSE_DISABLED";
  }

  const licenseExpiry = parseDate(license.expiresAt);

  if (licenseExpiry === null) {
    return "INVALID_CONFIG";
  }

  if (currentTime >= licenseExpiry) {
    return "LICENSE_EXPIRED";
  }

  // ===================================================
  // 3. CHECK FEATURE ENABLED STATUS
  // ===================================================

  if (!config.enabled) {
    return "DISABLED";
  }

  // ===================================================
  // 4. CHECK OPTIONAL FEATURE START DATE
  // ===================================================

  if (config.startsAt !== undefined && config.startsAt !== null) {
    const featureStart = parseDate(config.startsAt);

    if (featureStart === null) {
      return "INVALID_CONFIG";
    }

    if (currentTime < featureStart) {
      return "NOT_STARTED";
    }
  }

  // ===================================================
  // 5. CHECK FEATURE EXPIRATION
  // ===================================================

  const featureExpiry = parseDate(config.expiresAt);

  if (featureExpiry === null) {
    return "INVALID_CONFIG";
  }

  if (currentTime >= featureExpiry) {
    return "EXPIRED";
  }

  // ===================================================
  // 6. VALIDATE FEATURE DATE RANGE
  // ===================================================

  if (config.startsAt !== undefined && config.startsAt !== null) {
    const featureStart = parseDate(config.startsAt);

    if (featureStart === null || featureStart >= featureExpiry) {
      return "INVALID_CONFIG";
    }
  }

  // ===================================================
  // 7. VALIDATE BRANCH STORE LIMIT
  // ===================================================

  if (feature === "BRANCH_STORE") {
    if (
      config.branchLimit === undefined ||
      !Number.isSafeInteger(config.branchLimit) ||
      config.branchLimit < 1
    ) {
      return "INVALID_CONFIG";
    }
  }

  // ===================================================
  // 8. FEATURE IS ACTIVE
  // ===================================================

  return "ACTIVE";
};

// =====================================================
// CHECK FEATURE AVAILABILITY
// =====================================================

export const isFeatureAvailable = (
  feature: FeatureCode,
  now: Date = new Date(),
): boolean => {
  return getFeatureStatus(feature, now) === "ACTIVE";
};

// =====================================================
// ASSERT FEATURE AVAILABLE
// =====================================================

export const assertFeatureAvailable = (feature: FeatureCode): void => {
  const status = getFeatureStatus(feature);

  if (status !== "ACTIVE") {
    throw new AppError("This feature is currently unavailable", 403, {
      errorCode: "FEATURE_UNAVAILABLE",
      feature,
      status,
    });
  }
};

// =====================================================
// GET FEATURE LICENSE SUMMARY
// =====================================================

export const getFeatureLicenseSummary = (now: Date = new Date()) => {
  const features = featureLicenseConfig.features;

  return {
    license: {
      enabled: featureLicenseConfig.license.enabled,
      expiresAt: featureLicenseConfig.license.expiresAt,
    },

    features: Object.fromEntries(
      (Object.keys(features) as FeatureCode[]).map((feature) => {
        const config: FeatureConfig = features[feature];

        const status = getFeatureStatus(feature, now);

        return [
          feature,
          {
            enabled: config.enabled,
            available: status === "ACTIVE",
            status,
            startsAt: config.startsAt ?? null,
            expiresAt: config.expiresAt,

            ...(feature === "BRANCH_STORE"
              ? {
                  branchLimit: config.branchLimit,
                }
              : {}),
          },
        ];
      }),
    ),
  };
};
