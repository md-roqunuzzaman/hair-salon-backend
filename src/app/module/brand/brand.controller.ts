import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { brandService } from "./brand.service.js";

const getBrand = catchAsync(async (req: Request, res: Response) => {
  const result = await brandService.getBrand();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brand fetched successfully",
    data: result,
  });
});

const updateBrand = catchAsync(async (req: Request, res: Response) => {
  const result = await brandService.updateBrand(req.body);

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
