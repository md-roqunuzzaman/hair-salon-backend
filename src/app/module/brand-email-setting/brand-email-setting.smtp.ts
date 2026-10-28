import { prisma } from '../../lib/prisma.js';
import { sendMerchantSmtp } from '../../lib/merchant-smtp.js';
import { AppError } from '../../utils/app-error.js';

// Connectivity/authentication only. Verification still requires accepted test delivery.
export const testBrandSmtpConnection = async (brandId: string) => {
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  if (!setting) throw new AppError('Brand email configuration not found', 404);
  await sendMerchantSmtp(setting, { to: setting.fromEmail, subject: 'Connection test' }, true);
  return { success: true, provider: setting.provider, message: 'SMTP connectivity authenticated; no email sent', isVerified: setting.isVerified };
};
