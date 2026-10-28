import { connect } from 'cloudflare:sockets';
import { sendSmtpEmail } from './smtp.mjs';
import { applicationRuntime } from './context.mjs';
import { decryptEmailCredential } from '../../src/app/utils/email-credential-crypto.ts';
import { validateSmtpSetting } from '../../src/app/module/brand-email-setting/brand-email-setting.transport.ts';
import { EmailProviderError, safeEmailError } from '../../src/app/module/brand-email-setting/brand-email-setting.errors.ts';
export const customSmtpSupported = false;

export async function sendMerchantSmtp(setting, message, verifyOnly = false) {
  if (setting.provider === 'CUSTOM_SMTP') throw new EmailProviderError('EMAIL_CUSTOM_SMTP_REQUIRES_NODE_DELIVERY', 422, 'CONFIGURATION');
  validateSmtpSetting(setting);
  let password;
  try { password = decryptEmailCredential(setting.encryptedCredential); }
  catch { throw new EmailProviderError('EMAIL_CREDENTIAL_DECRYPTION_FAILED', 503, 'CONFIGURATION'); }
  try {
    return await sendSmtpEmail(applicationRuntime.getStore()?.connectSmtp ?? connect, {
      SMTP_HOST: setting.smtpHost, SMTP_PORT: String(setting.smtpPort),
      SMTP_USER: setting.smtpUsername, SMTP_PASSWORD: password,
      EMAIL_SENDER: { name: setting.fromName, address: setting.fromEmail },
    }, message, { verifyOnly });
  } catch (error) { throw safeEmailError(error); }
}
