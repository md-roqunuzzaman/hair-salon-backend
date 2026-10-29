import { resolveEmailBrand, sendBusinessEmail, resolveBusinessEmailDelivery } from '../module/brand-email-setting/brand-email-setting.sender.js';

// Compatibility adapter for old imports. It cannot use platform SMTP credentials.
export const transporter = {
  async sendMail(message: { to: string; subject: string; html?: string; text?: string; from?: unknown }) {
    const result = await sendBusinessEmail({ ...message, brandId: await resolveEmailBrand() });
    return { ...result, accepted: [message.to] };
  },
};
// Configuration readiness only; not a claim of remote SMTP connectivity/delivery.
export async function verifyEmailConnection() {
  try { await resolveBusinessEmailDelivery({ brandId: await resolveEmailBrand(), to:'readiness@example.com', subject:'Readiness only' }); return true; }
  catch { return false; }
}
