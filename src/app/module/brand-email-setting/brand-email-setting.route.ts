import { Router } from "express";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import {
  BrandEmailSettingController,
  testBusinessEmail,
  microsoftStart, microsoftCallback, microsoftDisconnect,
  resendDomainCreate, resendDomainCheck, resendDomainVerify,
} from "./brand-email-setting.controller.js";

import { brandEmailSettingValidation } from "./brand-email-setting.validation.js";

import { verifyBrandEmailAccess } from "./brand-email-setting.access.js";
import { Role } from "../../../../generated/prisma/enums.js";
import { disableSetting, enableSetting } from "./brand-email-setting.resend.js";
import { emailRateLimit } from './brand-email-setting.rate-limit.js';
import { prisma } from '../../lib/prisma.js';
import { catchAsync } from '../../utils/catchAsync.js';

const router = Router();
router.get('/microsoft/callback', microsoftCallback);
router.get('/:brandId/outbox', auth(Role.BRAND_OWNER), verifyBrandEmailAccess, catchAsync(async (req, res) => {
  const items = await prisma.emailOutbox.findMany({ where: { brandId: String(req.params.brandId) }, orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, eventType: true, status: true, attempts: true, maxAttempts: true, nextAttemptAt: true, attemptedAt: true, sentAt: true, provider: true, providerMessageId: true, lastError: true, createdAt: true } });
  const data = items.map(item => ({ ...item, lastError: item.lastError && /^EMAIL_[A-Z_]{2,64}$/.test(item.lastError) ? item.lastError : item.lastError ? 'EMAIL_LEGACY_FAILURE' : null }));
  res.json({ success: true, statusCode: 200, message: 'Email outbox status retrieved', data });
}));

// =====================================================
// GET BRAND EMAIL SETTINGS
// =====================================================

router.get(
  "/:brandId",
  auth(Role.BRAND_OWNER),
  verifyBrandEmailAccess,
  BrandEmailSettingController.getSetting,
);

// =====================================================
// SAVE / UPDATE BRAND EMAIL SETTINGS
// =====================================================

router.put(
  "/:brandId",
  auth(Role.BRAND_OWNER),
  verifyBrandEmailAccess,
  validateRequest(
    brandEmailSettingValidation.saveBrandEmailSettingValidationSchema,
  ),
  BrandEmailSettingController.saveSetting,
);

// =====================================================
// SEND TEST EMAIL
// =====================================================

router.post(
  "/:brandId/test-email",
  auth(Role.BRAND_OWNER),
  verifyBrandEmailAccess,
  validateRequest(
    brandEmailSettingValidation.sendBrandTestEmailValidationSchema,
  ),
  emailRateLimit('test-email'),
  BrandEmailSettingController.sendTestEmail,
);

router.patch(
  "/:brandId/enable",
  auth(Role.BRAND_OWNER),
  verifyBrandEmailAccess,
  emailRateLimit('enable'),
  enableSetting,
);
router.patch(
  "/:brandId/disable",
  auth(Role.BRAND_OWNER),
  verifyBrandEmailAccess,
  disableSetting,
);

router.post(
  "/:brandId/test-business-email",
  auth(Role.BRAND_OWNER),
  verifyBrandEmailAccess,
  validateRequest(brandEmailSettingValidation.businessTest),
  emailRateLimit('test-business-email'),
  testBusinessEmail,
);
router.post('/:brandId/microsoft/connect', auth(Role.BRAND_OWNER), verifyBrandEmailAccess, emailRateLimit('oauth-connect'), microsoftStart);
router.delete('/:brandId/microsoft/disconnect', auth(Role.BRAND_OWNER), verifyBrandEmailAccess, microsoftDisconnect);
router.post('/:brandId/resend/domain', auth(Role.BRAND_OWNER), verifyBrandEmailAccess, validateRequest(brandEmailSettingValidation.domain), emailRateLimit('domain-create'), resendDomainCreate);
router.get('/:brandId/resend/domain', auth(Role.BRAND_OWNER), verifyBrandEmailAccess, emailRateLimit('domain-status', 15), resendDomainCheck);
router.post('/:brandId/resend/domain/verify', auth(Role.BRAND_OWNER), verifyBrandEmailAccess, emailRateLimit('domain-verify'), resendDomainVerify);
export const BrandEmailSettingRoutes = router;
