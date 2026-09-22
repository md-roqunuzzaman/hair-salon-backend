import { NextFunction, Request, Response, Router } from "express";

import { validateRequest } from "../../middleware/validateRequest.js";

import { availabilityValidation } from "./availability.validation.js";
import { AvailabilityController } from "./availability.controller.js";

const router = Router();

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = req.query;
  next();
};

router.get(
  "/",
  queryToBody,
  validateRequest(availabilityValidation.getAvailabilityValidationSchema),
  AvailabilityController.getAvailability,
);

export const AvailabilityRoutes = router;
