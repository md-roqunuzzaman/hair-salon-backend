import type { Request, Response, NextFunction } from "express";

import { getFeatureStatus, type FeatureCode } from "../utils/featureLicense.js";

export const requireFeature = (feature: FeatureCode) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const status = getFeatureStatus(feature);

    if (status === "ACTIVE") {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      statusCode: 403,
      errorCode: "FEATURE_UNAVAILABLE",
      message: "This feature is currently unavailable",
      data: {
        feature,
        status,
      },
    });
  };
};
