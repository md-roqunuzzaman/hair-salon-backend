import { prisma } from '../../lib/prisma.js';
import { transporter } from '../../lib/nodemailer.js';
import config from '../../config/index.js';
import { sendConfiguredEmail, isProductionReady } from './brand-email-setting.providers.js';
import { logEmailFailure, EmailProviderError } from './brand-email-setting.errors.js';
import { z } from 'zod';

type TBusinessEmailPayload = { brandId: string; to: string; subject: string; html: string; text?: string; previousProvider?: string | null };
export const sendBusinessEmail = async (payload: TBusinessEmailPayload) => {
  return (await resolveBusinessEmailDelivery(payload)).send();
};

export const resolveBusinessEmailDelivery = async (payload: TBusinessEmailPayload) => {
  const recipient = z.email().safeParse(payload.to);
  if (!recipient.success) throw new EmailProviderError('EMAIL_RECIPIENT_INVALID', 422, 'CONFIGURATION');
  const to = recipient.data;
  const brands = await prisma.brand.findMany({ select: { id: true }, take: 2 });
  if (brands.length !== 1 || brands[0]!.id !== payload.brandId) throw new EmailProviderError('EMAIL_BRAND_CONTEXT_INVALID', 422, 'CONFIGURATION');
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId: payload.brandId } });
  const message = { to, subject: payload.subject, html: payload.html, text: payload.text };
  const merchantReady = !!setting && setting.isEnabled && setting.isVerified && isProductionReady(setting);
  const provider = merchantReady ? setting.provider : 'PLATFORM_SMTP';
  if (payload.previousProvider && payload.previousProvider !== provider) throw new EmailProviderError('EMAIL_RETRY_PROVIDER_CHANGED', 422, 'CONFIGURATION');
  if (!merchantReady) {
    return { provider: 'PLATFORM_SMTP', send: async () => {
      const result = await transporter.sendMail({ ...message, from: config.email_sender });
      return { success: true, mode: 'PLATFORM_DEFAULT' as const, provider: 'PLATFORM_SMTP', messageId: result.messageId };
    } };
  }
  return { provider: setting.provider, send: async () => { try {
    const result = await sendConfiguredEmail(setting, message);
    return { success: true, mode: 'MERCHANT' as const, provider: setting.provider, messageId: result.messageId };
  } catch (error) {
    const safe = logEmailFailure(setting.provider, error, setting);
    if (safe.code === 'EMAIL_PROVIDER_AUTHORIZATION_FAILED' || safe.code === 'EMAIL_AUTHENTICATION_FAILED') {
      await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion }, data: { isEnabled: false, isVerified: false, lastErrorCode: safe.code } });
    }
    throw safe; // Never fall back after an attempted merchant send.
  } } };
};
