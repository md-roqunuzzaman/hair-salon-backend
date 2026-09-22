import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync.js";
import { IAvailabilityQuery } from "./availability.interface.js";
import { AvailabilityService } from "./availability.service.js";
import { sendResponse } from "../../utils/sendResponse.js";

const getAvailability = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as unknown as IAvailabilityQuery;

  const result = await AvailabilityService.getAvailableSlots(query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Availability retrieved successfully",
    data: result,
  });
});

export const AvailabilityController = {
  getAvailability,
};
