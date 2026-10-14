import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";

import { brandService } from "./brand.service.js";

// =====================================================
// GET BRAND
// =====================================================

const getBrand = catchAsync(async (req: Request, res: Response) => {
  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await brandService.getBrand(language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brand fetched successfully",
    data: result,
  });
});

// =====================================================
// UPDATE BRAND
// =====================================================

const updateBrand = catchAsync(async (req: Request, res: Response) => {
  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await brandService.updateBrand(req.body, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brand updated successfully",
    data: result,
  });
});

export const brandController = {
  getBrand,
  updateBrand,
};
