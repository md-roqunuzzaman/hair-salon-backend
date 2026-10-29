import { listOutbox, getOutboxDetail, getOutboxHistory, skipOutboxJob } from './brand-email-setting.outbox-management.js';
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

const router = Router();
router.get('/microsoft/callback', microsoftCallback);
const outboxAccess = [auth(Role.BRAND_OWNER), verifyBrandEmailAccess];
router.get('/:brandId/outbox', ...outboxAccess, listOutbox());
router.get('/:brandId/outbox/audit', ...outboxAccess, listOutbox(true));
router.get('/:brandId/outbox/:jobId/history', ...outboxAccess, getOutboxHistory);
router.get('/:brandId/outbox/:jobId', ...outboxAccess, getOutboxDetail);
router.post('/:brandId/outbox/:jobId/skip', ...outboxAccess, skipOutboxJob);

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
