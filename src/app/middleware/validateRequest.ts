import { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/app-error.js";
import { validationDetails } from "../utils/normalize-error.js";

export const validateRequest = (zodSchema: z.ZodObject) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = zodSchema.safeParse({
      body: req.body ?? {},
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      const details = validationDetails(result.error.issues);
      throw new AppError(details[0]?.message ?? "Invalid request", 400, details);
    }

    req.body = result.data.body;

    next();
  });
};
