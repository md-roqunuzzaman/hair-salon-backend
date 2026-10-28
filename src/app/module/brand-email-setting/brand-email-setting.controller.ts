import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import {
  saveBrandEmailSetting,
  getBrandEmailSetting,
} from "./brand-email-setting.service.js";

import { sendBrandTestEmail } from "./brand-email-setting.test-email.js";

import type { TEmailProviderConfiguration } from "./brand-email-setting.validation.js";
import { AppError } from "../../utils/app-error.js";
import { sendBusinessEmail } from "./brand-email-setting.sender.js";
import { startMicrosoftAuthorization, finishMicrosoftAuthorization, disconnectMicrosoft } from './brand-email-setting.microsoft.js';
import { manageResendDomain } from './brand-email-setting.domain.js';
import { z } from 'zod';

// Temporary helper until the brand context is wired
// to your existing authentication/authorization system.
const getBrandId = (req: Request): string => {
  const brandId = req.params.brandId;

  if (typeof brandId !== "string" || !brandId.trim()) {
    throw new AppError("Brand ID is required", httpStatus.BAD_REQUEST);
  }

  return brandId;
};

// 1. SAVE OR UPDATE EMAIL CONFIGURATION
const saveSetting = catchAsync(async (req: Request, res: Response) => {
  const brandId = getBrandId(req);

  const result = await saveBrandEmailSetting(
    brandId,
    req.body as TEmailProviderConfiguration,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brand email configuration saved successfully",
    data: result,
  });
});

// 2. GET EMAIL CONFIGURATION
const getSetting = catchAsync(async (req: Request, res: Response) => {
  const brandId = getBrandId(req);

  const result = await getBrandEmailSetting(brandId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brand email configuration retrieved successfully",
    data: result,
  });
});

// 3. SEND TEST EMAIL
const sendTestEmail = catchAsync(async (req: Request, res: Response) => {
  const brandId = getBrandId(req);

  const recipientEmail = req.body?.recipientEmail;

  if (typeof recipientEmail !== "string" || !recipientEmail.trim()) {
    throw new AppError("Recipient email is required", httpStatus.BAD_REQUEST);
  }

  const result = await sendBrandTestEmail(brandId, recipientEmail);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Test email sending request completed",
    data: result,
  });
});

export const BrandEmailSettingController = {
  saveSetting,
  getSetting,
  sendTestEmail,
};

export const microsoftStart = catchAsync(async (req, res) => {
  const data = await startMicrosoftAuthorization(getBrandId(req), req.user!.userId);
  sendResponse(res, { statusCode: 200, success: true, message: 'Microsoft authorization URL created', data });
});
export const microsoftCallback = catchAsync(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const query = z.object({ state: z.string().max(100), code: z.string().max(8192).optional(), error: z.string().max(200).optional() }).safeParse(req.query);
  if (!query.success) throw new AppError('Invalid OAuth callback', 400);
  const data = await finishMicrosoftAuthorization(query.data.state, query.data.code, !!query.data.error);
  sendResponse(res, { statusCode: 200, success: true, message: 'Microsoft account authorized; provider remains disabled', data });
});
export const microsoftDisconnect = catchAsync(async (req, res) => {
  const data = await disconnectMicrosoft(getBrandId(req));
  sendResponse(res, { statusCode: 200, success: true, message: 'Microsoft tokens disconnected locally', data });
});
export const resendDomainCreate = catchAsync(async (req, res) => {
  const data = await manageResendDomain(getBrandId(req), 'create', req.body.domain);
  sendResponse(res, { statusCode: 200, success: true, message: 'Sender domain DNS records', data });
});
export const resendDomainCheck = catchAsync(async (req, res) => {
  const data = await manageResendDomain(getBrandId(req), 'check');
  sendResponse(res, { statusCode: 200, success: true, message: 'Sender domain status', data });
});
export const resendDomainVerify = catchAsync(async (req, res) => {
  const data = await manageResendDomain(getBrandId(req), 'verify');
  sendResponse(res, { statusCode: 200, success: true, message: 'Sender domain verification requested', data });
});

export const testBusinessEmail = catchAsync(
  async (req: Request, res: Response) => {
    const brandId = req.params.brandId as string;

    const { to } = req.body as {
      to: string;
    };

    const result = await sendBusinessEmail({
      brandId,
      to,
      subject: "ABC Hair Salon - Business Email Test",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>ABC Hair Salon</h2>
          <p>Business email configuration test successful.</p>
          <p>This email was sent using the configured business email provider.</p>
        </div>
      `,
      text: "ABC Hair Salon business email configuration test.",
    });

    return sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Business email test completed successfully",
      data: result,
    });
  },
);
