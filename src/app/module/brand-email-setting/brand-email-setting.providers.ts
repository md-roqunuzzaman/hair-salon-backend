import type { BrandEmailSetting } from '../../../../generated/prisma/client.js';
import { sendMerchantSmtp, customSmtpSupported } from '../../lib/merchant-smtp.js';
import { EmailProviderError } from './brand-email-setting.errors.js';
import { emailProviderRequest } from './brand-email-setting.http.js';
import { isResendReady, resendKey, senderDomain } from './brand-email-setting.domain.js';
import { sendMicrosoftEmail } from './brand-email-setting.microsoft.js';
import { validateSmtpSetting, type EmailMessage } from './brand-email-setting.transport.js';

export function isProductionReady(setting: BrandEmailSetting): boolean {
  if (setting.provider === 'RESEND') return isResendReady(setting) && !!setting.encryptedCredential;
  if (setting.provider === 'MICROSOFT_365') return !!setting.oauthDataEncrypted;
  if (setting.provider === 'CUSTOM_SMTP' && !customSmtpSupported) return false;
  try { validateSmtpSetting(setting); return true; } catch { return false; }
}
export async function sendConfiguredEmail(setting: BrandEmailSetting, message: EmailMessage, testOnly = false) {
  if (setting.provider === 'MICROSOFT_365') return sendMicrosoftEmail(setting, message);
  if (setting.provider !== 'RESEND') return sendMerchantSmtp(setting, message);
  const sandbox = senderDomain(setting.fromEmail) === 'resend.dev';
  if ((!testOnly || !sandbox) && !isResendReady(setting)) throw new EmailProviderError('EMAIL_RESEND_DOMAIN_NOT_VERIFIED', 422, 'CONFIGURATION');
  const response = await emailProviderRequest('https://api.resend.com/emails', { method: 'POST', headers: {
    Authorization: `Bearer ${resendKey(setting)}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ from: `${setting.fromName} <${setting.fromEmail}>`, to: [message.to], subject: message.subject,
    ...(message.text !== undefined ? { text: message.text } : {}), ...(message.html !== undefined ? { html: message.html } : {}),
  }) }, true);
  const result = await response.json() as { id?: string };
  if (!result.id || typeof result.id !== 'string') throw new EmailProviderError('EMAIL_PROVIDER_ACCEPTANCE_UNKNOWN', 502, 'SEND', true);
  return { messageId: result.id, accepted: [message.to] };
}
