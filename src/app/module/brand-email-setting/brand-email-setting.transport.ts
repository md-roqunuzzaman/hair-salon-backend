import type { BrandEmailSetting } from '../../../../generated/prisma/client.js';
import { EmailProviderError } from './brand-email-setting.errors.js';

export type EmailMessage = { to: string; subject: string; text?: string; html?: string };
export const SMTP_HOSTS: Record<string, string> = { GMAIL: 'smtp.gmail.com', QQ: 'smtp.qq.com', NETEASE_163: 'smtp.163.com' };

export function validateSmtpSetting(setting: BrandEmailSetting) {
  if (!setting.smtpUsername || !setting.encryptedCredential || !setting.smtpHost || !setting.smtpPort) throw new EmailProviderError('EMAIL_SMTP_INCOMPLETE', 422, 'CONFIGURATION');
  const expected = SMTP_HOSTS[setting.provider];
  if (expected && (setting.smtpHost !== expected || setting.smtpPort !== 465 || !setting.smtpSecure)) throw new EmailProviderError('EMAIL_SMTP_INVALID', 422, 'CONFIGURATION');
  if (!expected && setting.provider !== 'CUSTOM_SMTP') throw new EmailProviderError('EMAIL_PROVIDER_NOT_SMTP', 422, 'CONFIGURATION');
  if (expected && setting.fromEmail.toLowerCase() !== setting.smtpUsername.toLowerCase()) throw new EmailProviderError('EMAIL_SENDER_IDENTITY_MISMATCH', 422, 'CONFIGURATION');
}
