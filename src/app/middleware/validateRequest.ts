import { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/app-error.js";

export const validateRequest = (zodSchema: z.ZodObject) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = zodSchema.safeParse({
      body: req.body ?? {},
    });

    if (!result.success) {
      throw new AppError(result.error.issues[0].message, 400);
    }

    req.body = result.data.body;

    next();
  });
};
