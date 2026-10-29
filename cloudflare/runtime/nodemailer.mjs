import { resolveEmailBrand, sendBusinessEmail, resolveBusinessEmailDelivery } from '../../src/app/module/brand-email-setting/brand-email-setting.sender.ts';
export const transporter = {
  async sendMail(message) {
    const result = await sendBusinessEmail({ ...message, brandId: await resolveEmailBrand() });
    return { ...result, accepted:[message.to] };
  },
};
export async function verifyEmailConnection() {
  try { await resolveBusinessEmailDelivery({brandId:await resolveEmailBrand(),to:'readiness@example.com',subject:'Readiness only'}); return true; }
  catch { return false; }
}
