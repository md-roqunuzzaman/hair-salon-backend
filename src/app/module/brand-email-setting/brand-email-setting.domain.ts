import { Prisma, type BrandEmailSetting } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { decryptEmailCredential } from '../../utils/email-credential-crypto.js';
import { EmailProviderError } from './brand-email-setting.errors.js';
import { emailProviderRequest } from './brand-email-setting.http.js';

export type ResendDomain = { id: string; name: string; status: string; records?: {record?: string; name: string; type: string; value: string; priority?: number; status?: string; ttl?: string}[]; capabilities?: { sending?: string } };
export function senderDomain(email: string) { return email.split('@')[1]?.toLowerCase(); }
export function isResendReady(setting: BrandEmailSetting) {
  const data = setting.providerData as ResendDomain | null;
  return !!data && data.status === 'verified' && data.name === senderDomain(setting.fromEmail) && data.capabilities?.sending === 'enabled' && data.name !== 'resend.dev' && !data.name.endsWith('.resend.dev');
}
export function resendKey(setting: BrandEmailSetting) {
  if (!setting.encryptedCredential) throw new EmailProviderError('EMAIL_RESEND_KEY_MISSING', 422, 'CONFIGURATION');
  try { return decryptEmailCredential(setting.encryptedCredential); }
  catch { throw new EmailProviderError('EMAIL_CREDENTIAL_DECRYPTION_FAILED', 503, 'CONFIGURATION'); }
}
export async function manageResendDomain(brandId: string, action: 'create' | 'check' | 'verify', domain?: string) {
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  if (!setting || setting.provider !== 'RESEND') throw new EmailProviderError('EMAIL_RESEND_NOT_CONFIGURED', 422, 'CONFIGURATION');
  const headers = { Authorization: `Bearer ${resendKey(setting)}`, 'Content-Type': 'application/json' };
  const stored = setting.providerData as ResendDomain | null;
  let id = stored?.id;
  if (action === 'create') {
    if (!domain || domain !== senderDomain(setting.fromEmail) || domain === 'resend.dev' || domain.endsWith('.resend.dev')) throw new EmailProviderError('EMAIL_SENDER_DOMAIN_MISMATCH', 422, 'CONFIGURATION');
    if (!id || stored?.name !== domain) {
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const listResponse = await emailProviderRequest(`https://api.resend.com/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, { headers });
        const list = await listResponse.json() as { data?: {id: string; name: string}[]; has_more?: boolean };
        if (!Array.isArray(list.data)) throw new EmailProviderError('EMAIL_DOMAIN_RESPONSE_INVALID', 502, 'CONFIGURATION');
        id = list.data.find(item => item.name === domain)?.id;
        if (id || !list.has_more) break;
        after = list.data.at(-1)?.id;
        if (!after || page === 19) throw new EmailProviderError('EMAIL_DOMAIN_DISCOVERY_INCOMPLETE', 422, 'CONFIGURATION');
      }
      if (!id) {
        const created = await emailProviderRequest('https://api.resend.com/domains', { method: 'POST', headers, body: JSON.stringify({ name: domain }) });
        id = ((await created.json()) as ResendDomain).id;
      }
    }
  }
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new EmailProviderError('EMAIL_DOMAIN_NOT_REGISTERED', 422, 'CONFIGURATION');
  if (action === 'verify') await emailProviderRequest(`https://api.resend.com/domains/${id}/verify`, { method: 'POST', headers });
  const response = await emailProviderRequest(`https://api.resend.com/domains/${id}`, { headers });
  const result = await response.json() as ResendDomain;
  if (result.id !== id || result.name !== senderDomain(setting.fromEmail) || !Array.isArray(result.records)) throw new EmailProviderError('EMAIL_DOMAIN_RESPONSE_INVALID', 502, 'CONFIGURATION');
  const safe: ResendDomain = { id, name: result.name, status: result.status,
    capabilities: { sending: result.capabilities?.sending }, records: result.records.map(r => ({ record: r.record, name: r.name, type: r.type, value: r.value, priority: r.priority, status: r.status, ttl: r.ttl })) };
  const ready = isResendReady({ ...setting, providerData: safe as unknown as Prisma.JsonValue });
  const updated = await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion, encryptedCredential: setting.encryptedCredential }, data: {
    providerData: safe as unknown as Prisma.InputJsonValue, ...(!ready ? { isVerified: false } : {}),
  } });
  if (updated.count !== 1) throw new EmailProviderError('EMAIL_CONFIGURATION_CHANGED', 409, 'CONFIGURATION');
  return { ...safe, productionReady: ready };
}
