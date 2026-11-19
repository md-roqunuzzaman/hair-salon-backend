import { NextFunction, Request, Response, Router } from "express";

import { validateRequest } from "../../middleware/validateRequest.js";
import { isFeatureAvailable } from "../../utils/featureLicense.js";
import { AppError } from "../../utils/app-error.js";

import { availabilityValidation } from "./availability.validation.js";
import { AvailabilityController } from "./availability.controller.js";

const router = Router();

// =====================================================
// QUERY HELPER
// =====================================================

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = req.query;
  next();
};

// =====================================================
// HAIRSTYLIST LICENSE GUARD
// =====================================================
//
// HAIRSTYLIST ACTIVE:
//   All existing staff preference modes available.
//
// HAIRSTYLIST DISABLED / EXPIRED:
//   Explicit staff selection is unavailable.
//
// Normal availability remains accessible.
// =====================================================

const checkHairstylistLicense = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (isFeatureAvailable("HAIRSTYLIST")) {
      return next();
    }

    const { staffId, staffPreference } = req.body;

    if (staffId !== undefined || staffPreference === "SELECT_STAFF") {
      throw new AppError(
        "Hairstylist selection is unavailable because the feature is disabled or expired.",
        403,
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

// =====================================================
// GET AVAILABILITY
// =====================================================

router.get(
  "/",
  queryToBody,
  validateRequest(availabilityValidation.getAvailabilityValidationSchema),
  checkHairstylistLicense,
  AvailabilityController.getAvailability,
);

// =====================================================
// EXPORT ROUTES
// =====================================================

export const AvailabilityRoutes = router;
