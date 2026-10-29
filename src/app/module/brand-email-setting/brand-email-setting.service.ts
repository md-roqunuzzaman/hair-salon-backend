import { Prisma } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/app-error.js';
import { encryptEmailCredential, decryptEmailCredential } from '../../utils/email-credential-crypto.js';
import type { TEmailProviderConfiguration } from './brand-email-setting.validation.js';
import { emailProviderConfigurationSchema } from './brand-email-setting.validation.js';
import { SMTP_HOSTS } from './brand-email-setting.transport.js';
import { isProductionReady } from './brand-email-setting.providers.js';
import { checkMicrosoftIdentity } from './brand-email-setting.microsoft.js';
import { manageResendDomain } from './brand-email-setting.domain.js';
import { customSmtpSupported } from '../../lib/merchant-smtp.js';

export const safeEmailSettingSelect = {
  id: true, brandId: true, provider: true, fromName: true, fromEmail: true,
  smtpHost: true, smtpPort: true, smtpSecure: true, smtpUsername: true,
  isEnabled: true, isVerified: true, configurationVersion: true, providerData: true,
  lastTestAt: true, lastErrorCode: true, createdAt: true, updatedAt: true,
} satisfies Prisma.BrandEmailSettingSelect;

export const saveBrandEmailSetting = async (brandId: string, raw: TEmailProviderConfiguration) => {
  const parsed = emailProviderConfigurationSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('Invalid email provider configuration', 400);
  const payload = parsed.data;
  if (!await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } })) throw new AppError('Brand not found', 404);
  const existing = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  const sameProvider = existing?.provider === payload.provider;
  let smtpHost: string | null = null, smtpPort: number | null = null, smtpSecure: boolean | null = null, smtpUsername: string | null = null;
  let secret: string | undefined;
  if (payload.provider === 'RESEND') secret = payload.apiKey;
  else if (payload.provider !== 'MICROSOFT_365') {
    smtpUsername = payload.smtpUsername;
    secret = payload.password;
    smtpHost = payload.provider === 'CUSTOM_SMTP' ? payload.smtpHost : SMTP_HOSTS[payload.provider];
    smtpPort = payload.provider === 'CUSTOM_SMTP' ? payload.smtpPort : 465;
    smtpSecure = payload.provider === 'CUSTOM_SMTP' ? payload.smtpSecure : true;
    if (payload.provider !== 'CUSTOM_SMTP' && payload.fromEmail !== payload.smtpUsername) throw new AppError('EMAIL_SENDER_IDENTITY_MISMATCH', 422);
    if (payload.provider === 'CUSTOM_SMTP' && payload.smtpPort === 465 && !payload.smtpSecure) throw new AppError('EMAIL_UNSAFE_SMTP_TLS', 422);
    if (payload.provider === 'GMAIL' && secret) {
      secret = secret.replace(/\s/g, '');
      if (!/^[a-zA-Z0-9]{16}$/.test(secret)) throw new AppError('Gmail requires a 16-character Google App Password', 422);
    }
  }
  let encryptedCredential: string | null = null;
  if (payload.provider !== 'MICROSOFT_365') {
    if (secret) {
      try { encryptedCredential = encryptEmailCredential(secret); }
      catch { throw new AppError('EMAIL_ENCRYPTION_KEY_CONFIGURATION_REQUIRED', 503); }
    } else if (sameProvider && existing?.encryptedCredential) encryptedCredential = existing.encryptedCredential;
    else throw new AppError('New provider credentials are required', 422);
  }
  let credentialChanged = !!secret;
  if (secret && sameProvider && existing?.encryptedCredential) {
    try { credentialChanged = decryptEmailCredential(existing.encryptedCredential) !== secret; }
    catch { credentialChanged = true; }
  }
  const deliveryChanged = !existing || !sameProvider || credentialChanged ||
    existing.fromEmail !== payload.fromEmail || existing.smtpHost !== smtpHost ||
    existing.smtpPort !== smtpPort || existing.smtpSecure !== smtpSecure || existing.smtpUsername !== smtpUsername;
  const fields = {
    provider: payload.provider, fromName: payload.fromName, fromEmail: payload.fromEmail,
    smtpHost, smtpPort, smtpSecure, smtpUsername, encryptedCredential,
    // Enabled is owner intent, verification is transport readiness. Only explicit
    // enable/disable controls change an existing merchant's intent.
    isEnabled: existing?.isEnabled ?? true,
    ...(deliveryChanged ? { oauthDataEncrypted: null, isVerified: false, providerData: Prisma.DbNull, lastTestAt: null, lastErrorCode: null } : {}),
  };
  // Compare versions so concurrent credential rotations never overwrite each other.
  if (existing) {
    const changed = await prisma.brandEmailSetting.updateMany({ where: { id: existing.id, configurationVersion: existing.configurationVersion, isEnabled: existing.isEnabled }, data: { ...fields, configurationVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new AppError('Email configuration changed. Please retry.', 409);
    return prisma.brandEmailSetting.findUnique({ where: { brandId }, select: safeEmailSettingSelect });
  }
  return prisma.brandEmailSetting.create({ data: { brandId, ...fields }, select: safeEmailSettingSelect });
};
export const getBrandEmailSetting = async (brandId: string) => {
  const current = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  // Read credential presence internally for readiness, but return only the
  // existing public allowlist. Never serialize tokens or encrypted credentials.
  const setting = current ? Object.fromEntries(Object.keys(safeEmailSettingSelect).map(key => [key, current[key as keyof typeof current]])) : null;
  return { configurationMode: setting ? 'MERCHANT' : 'PLATFORM_DEFAULT', isConfigured: !!setting, provider: setting?.provider ?? null, setting,
    defaults: { isEnabled: true, isVerified: false },
    sendingStatus: !current ? 'EMAIL_NOT_CONFIGURED' : !current.isEnabled ? 'EMAIL_DISABLED' : !current.isVerified ? 'EMAIL_NOT_VERIFIED' : isProductionReady(current) ? 'READY' : 'EMAIL_PROVIDER_NOT_READY',
    runtimeCapabilities: { customSmtp: customSmtpSupported, fixedProviderSmtp: true, microsoftGraph: true, resend: true } };
};
export const enableBrandEmailSetting = async (brandId: string) => {
  let setting = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  if (!setting) throw new AppError('Brand email configuration not found', 404);
  if (!setting.isVerified) throw new AppError('Successfully test or authorize this configuration before enabling it', 422);
  const expectedVersion = setting.configurationVersion;
  if (setting.provider === 'RESEND') {
    await manageResendDomain(brandId, 'check');
    setting = (await prisma.brandEmailSetting.findUnique({ where: { brandId } }))!;
    if (!setting || setting.configurationVersion !== expectedVersion || setting.provider !== 'RESEND') throw new AppError('Email configuration changed. Please retry.', 409);
  }
  if (setting.provider === 'MICROSOFT_365') await checkMicrosoftIdentity(setting);
  if (!isProductionReady(setting)) throw new AppError('EMAIL_PROVIDER_NOT_PRODUCTION_READY', 422);
  const changed = await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion, isVerified: true }, data: { isEnabled: true } });
  if (changed.count !== 1) throw new AppError('Email configuration changed. Please retry.', 409);
  return prisma.brandEmailSetting.findUnique({ where: { brandId }, select: safeEmailSettingSelect });
};
export const disableBrandEmailSetting = async (brandId: string) => {
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  if (!setting) throw new AppError('Brand email configuration not found', 404);
  const changed = await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion }, data: { isEnabled: false, configurationVersion: { increment: 1 } } });
  if (changed.count !== 1) throw new AppError('Email configuration changed. Please retry.', 409);
  return prisma.brandEmailSetting.findUnique({ where: { brandId }, select: safeEmailSettingSelect });
};
