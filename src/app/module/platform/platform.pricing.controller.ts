import type { Request, Response } from "express";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import {
  getPlatformPricing,
  updateStandardPlanPrice,
  updatePremiumAddonPrice,
} from "./platform.pricing.service.js";

import { updatePricingSchema } from "./platform.pricing.validation.js";

// =====================================================
// 1. GET PRICING
// =====================================================

export const getPricing = catchAsync(async (_req: Request, res: Response) => {
  const data = await getPlatformPricing();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Platform pricing fetched successfully",
    data,
  });
});

// =====================================================
// 2. UPDATE STANDARD PLAN PRICE
// =====================================================

export const updatePlanPricing = catchAsync(
  async (req: Request, res: Response) => {
    const payload = updatePricingSchema.parse(req.body);

    const data = await updateStandardPlanPrice(payload);

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Standard plan pricing updated successfully",
      data,
    });
  },
);

// =====================================================
// 3. UPDATE PREMIUM ADD-ON PRICE
// =====================================================

export const updateAddonPricing = catchAsync(
  async (req: Request, res: Response) => {
    const payload = updatePricingSchema.parse(req.body);

    const code = req.params.code;

    if (typeof code !== "string") {
      throw new Error("Premium feature code is required");
    }

    const data = await updatePremiumAddonPrice(code, payload);

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Premium feature pricing updated successfully",
      data,
    });
  },
);
