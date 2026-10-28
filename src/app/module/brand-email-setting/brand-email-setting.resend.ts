import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { disableBrandEmailSetting, enableBrandEmailSetting } from "./brand-email-setting.service.js";
import { manageResendDomain } from "./brand-email-setting.domain.js";
import type { Request, Response } from "express";
// Domain verification is required; listing API keys is not a delivery test.
export const testBrandResendConnection = (brandId: string) => manageResendDomain(brandId, 'check');
export const enableSetting = catchAsync(async (req: Request, res: Response) => {
  const brandId = req.params.brandId as string;

  const data = await enableBrandEmailSetting(brandId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Brand email provider enabled successfully",
    data,
  });
});

export const disableSetting = catchAsync(
  async (req: Request, res: Response) => {
    const brandId = req.params.brandId as string;

    const data = await disableBrandEmailSetting(brandId);

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Brand email provider disabled successfully",
      data,
    });
  },
);
