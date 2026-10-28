import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/app-error.js';
import { sendConfiguredEmail, isProductionReady } from './brand-email-setting.providers.js';
import { logEmailFailure } from './brand-email-setting.errors.js';

export const sendBrandTestEmail = async (brandId: string, recipientEmail: string) => {
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  if (!setting) throw new AppError('Brand email configuration not found', 404);
  let result;
  try {
    result = await sendConfiguredEmail(setting, { to: recipientEmail, subject: 'Email Configuration Test', text: 'This is a test email from your salon email configuration.' }, true);
  } catch (error) {
    const safe = logEmailFailure(setting.provider, error, setting);
    await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion }, data: { isVerified: false, isEnabled: false, lastErrorCode: safe.code } });
    throw safe;
  }
  const ready = isProductionReady(setting);
  const updated = await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion }, data: { isVerified: ready, lastTestAt: new Date(), lastErrorCode: null } });
  if (updated.count !== 1) throw new AppError('Test accepted, but configuration changed; test the new configuration', 409);
  return { success: true, provider: setting.provider, message: 'Test email accepted by configured provider', messageId: result.messageId, isVerified: ready, productionReady: ready };
};
