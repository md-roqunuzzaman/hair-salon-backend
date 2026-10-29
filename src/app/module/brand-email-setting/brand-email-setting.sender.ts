import { prisma } from '../../lib/prisma.js';
import { sendConfiguredEmail, isProductionReady } from './brand-email-setting.providers.js';
import { logEmailFailure, EmailProviderError } from './brand-email-setting.errors.js';
import { z } from 'zod';

// This deployment/database is the tenant boundary, never the recipient address.
export async function resolveEmailBrand(requestedBrandId?: string) {
  const brands = await prisma.brand.findMany({ select: { id: true }, take: 2 });
  if (brands.length !== 1 || (requestedBrandId && requestedBrandId !== brands[0]!.id)) throw new EmailProviderError('EMAIL_BRAND_CONTEXT_INVALID', 422, 'CONFIGURATION');
  return brands[0]!.id;
}
type Payload = { brandId: string; to: string; subject: string; html?: string; text?: string; previousProvider?: string | null };
export const resolveBusinessEmailDelivery = async (payload: Payload, configurationTest = false) => {
  const recipient = z.email().safeParse(payload.to);
  if (!recipient.success) throw new EmailProviderError('EMAIL_RECIPIENT_INVALID', 422, 'CONFIGURATION');
  await resolveEmailBrand(payload.brandId);
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId: payload.brandId } });
  if (!setting) throw new EmailProviderError('EMAIL_NOT_CONFIGURED', 422, 'CONFIGURATION');
  // The owner-only configuration test must be able to verify a disabled setting.
  if (!configurationTest) {
    if (!setting.isEnabled) throw new EmailProviderError('EMAIL_DISABLED', 422, 'CONFIGURATION');
    if (!setting.isVerified) throw new EmailProviderError('EMAIL_NOT_VERIFIED', 422, 'CONFIGURATION');
    if (!isProductionReady(setting)) throw new EmailProviderError('EMAIL_PROVIDER_NOT_READY', 422, 'CONFIGURATION');
  }
  if (payload.previousProvider && payload.previousProvider !== setting.provider) throw new EmailProviderError('EMAIL_RETRY_PROVIDER_CHANGED', 422, 'CONFIGURATION');
  const message = { to: recipient.data, subject: payload.subject, html: payload.html, text: payload.text };
  return { provider: setting.provider, setting, send: async () => {
    const current = await prisma.brandEmailSetting.findUnique({ where: { brandId: payload.brandId } });
    if (!current || current.configurationVersion !== setting.configurationVersion || (!configurationTest && (!current.isEnabled || !current.isVerified))) throw new EmailProviderError('EMAIL_CONFIGURATION_CHANGED', 409, 'CONFIGURATION');
    try {
      const result = await sendConfiguredEmail(setting, message, configurationTest);
      return { success: true, mode: 'MERCHANT' as const, provider: setting.provider, messageId: result.messageId };
    } catch (error) {
      const safe = logEmailFailure(setting.provider, error, setting);
      if (safe.code === 'EMAIL_PROVIDER_AUTHORIZATION_FAILED' || safe.code === 'EMAIL_AUTHENTICATION_FAILED') await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion }, data: { isVerified: false, lastErrorCode: safe.code } });
      throw safe;
    }
  } };
};
export const sendBusinessEmail = async (payload: Payload) => (await resolveBusinessEmailDelivery(payload)).send();
