import { createHash, randomBytes } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type { BrandEmailSetting } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { redisClient } from '../../lib/redis.js';
import { decryptEmailCredential, encryptEmailCredential } from '../../utils/email-credential-crypto.js';
import { EmailProviderError } from './brand-email-setting.errors.js';
import { emailProviderRequest } from './brand-email-setting.http.js';
import type { EmailMessage } from './brand-email-setting.transport.js';

const scope = 'offline_access User.Read Mail.Send';
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number; accountId: string; email: string };
function oauthConfig() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.EMAIL_ENCRYPTION_KEY ?? '')) throw new EmailProviderError('EMAIL_ENCRYPTION_KEY_CONFIGURATION_REQUIRED', 503, 'CONFIGURATION');
  const clientId = process.env.MICROSOFT_EMAIL_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_EMAIL_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_EMAIL_REDIRECT_URI;
  const tenant = process.env.MICROSOFT_EMAIL_TENANT || 'organizations';
  if (!clientId || !clientSecret || !redirectUri || !/^(organizations|[0-9a-f-]{36})$/i.test(tenant)) throw new EmailProviderError('EMAIL_MICROSOFT_SETUP_REQUIRED', 503, 'CONFIGURATION');
  let url: URL;
  try { url = new URL(redirectUri); } catch { throw new EmailProviderError('EMAIL_MICROSOFT_REDIRECT_INVALID', 503, 'CONFIGURATION'); }
  if ((url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && url.hostname === 'localhost')) || url.search || url.hash || url.username || url.password) throw new EmailProviderError('EMAIL_MICROSOFT_REDIRECT_INVALID', 503, 'CONFIGURATION');
  return { clientId, clientSecret, redirectUri, base: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0` };
}
function decodeTokens(value: string | null): Tokens {
  try {
    const parsed = JSON.parse(decryptEmailCredential(value ?? '')) as Tokens;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.accountId || !parsed.email || !Number.isFinite(parsed.expiresAt)) throw new Error();
    return parsed;
  } catch { throw new EmailProviderError('EMAIL_MICROSOFT_REAUTHORIZE', 422, 'AUTH'); }
}
async function exchange(parameters: Record<string,string>) {
  const config = oauthConfig();
  let response: Response;
  try { response = await fetch(`${config.base}/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope, ...parameters }) }); }
  catch { throw new EmailProviderError('EMAIL_MICROSOFT_NETWORK_FAILED', 502, 'AUTH'); }
  if (!response.ok) throw new EmailProviderError(response.status === 429 ? 'EMAIL_PROVIDER_RATE_LIMITED' : response.status >= 500 ? 'EMAIL_MICROSOFT_UNAVAILABLE' : 'EMAIL_MICROSOFT_REAUTHORIZE', response.status === 429 ? 429 : response.status >= 500 ? 502 : 422, 'AUTH');
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  const scopes = new Set(data.scope?.toLowerCase().split(' '));
  if (!data.access_token || !data.expires_in || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.token_type?.toLowerCase() !== 'bearer' || !scopes.has('mail.send') || !scopes.has('user.read')) throw new EmailProviderError('EMAIL_MICROSOFT_INVALID_TOKEN_RESPONSE', 502, 'AUTH');
  return data as typeof data & { access_token: string; expires_in: number };
}
async function identity(accessToken: string, fromEmail: string, expectedId?: string) {
  const response = await emailProviderRequest('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', { headers: { Authorization: `Bearer ${accessToken}` } });
  const account = await response.json() as { id?: string; mail?: string; userPrincipalName?: string };
  const email = (account.mail || account.userPrincipalName || '').toLowerCase();
  if (!account.id || email !== fromEmail.toLowerCase() || (expectedId && account.id !== expectedId)) throw new EmailProviderError('EMAIL_MICROSOFT_IDENTITY_MISMATCH', 422, 'AUTH');
  return { accountId: account.id, email };
}
export async function startMicrosoftAuthorization(brandId: string, userId: string) {
  const config = oauthConfig();
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  if (!setting || setting.provider !== 'MICROSOFT_365') throw new EmailProviderError('EMAIL_MICROSOFT_NOT_CONFIGURED', 422, 'CONFIGURATION');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  await redisClient.set(`merchant-email-oauth:${createHash('sha256').update(state).digest('hex')}`, encryptEmailCredential(JSON.stringify({ brandId, userId, version: setting.configurationVersion, verifier, redirectUri: config.redirectUri })), { EX: 600 });
  const url = new URL(`${config.base}/authorize`);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', response_mode: 'query', scope,
    state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
  return { authorizationUrl: url.toString(), expiresIn: 600 };
}
export async function finishMicrosoftAuthorization(state: string, code?: string, denied?: boolean) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(state)) throw new EmailProviderError('EMAIL_OAUTH_STATE_INVALID', 400, 'AUTH');
  const stored = await redisClient.getDel(`merchant-email-oauth:${createHash('sha256').update(state).digest('hex')}`);
  if (!stored) throw new EmailProviderError('EMAIL_OAUTH_STATE_EXPIRED_OR_USED', 400, 'AUTH');
  let context: { brandId: string; userId: string; version: number; verifier: string; redirectUri: string };
  try { context = JSON.parse(decryptEmailCredential(stored)); } catch { throw new EmailProviderError('EMAIL_OAUTH_STATE_INVALID', 400, 'AUTH'); }
  if (denied || !code || code.length > 8192) throw new EmailProviderError('EMAIL_MICROSOFT_AUTHORIZATION_DENIED', 422, 'AUTH');
  const user = await prisma.user.findUnique({ where: { id: context.userId } });
  const brands = await prisma.brand.findMany({ select: { id: true }, take: 2 });
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId: context.brandId } });
  const config = oauthConfig();
  if (!user || user.role !== 'BRAND_OWNER' || user.status !== 'ACTIVE' || brands.length !== 1 || brands[0].id !== context.brandId || !setting || setting.provider !== 'MICROSOFT_365' || setting.configurationVersion !== context.version || config.redirectUri !== context.redirectUri) throw new EmailProviderError('EMAIL_OAUTH_CONFIGURATION_CHANGED', 409, 'AUTH');
  const data = await exchange({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: context.verifier });
  if (!data.refresh_token) throw new EmailProviderError('EMAIL_MICROSOFT_OFFLINE_ACCESS_REQUIRED', 422, 'AUTH');
  const account = await identity(data.access_token, setting.fromEmail);
  const tokens: Tokens = { ...account, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
  const updated = await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion, provider: 'MICROSOFT_365' }, data: {
    oauthDataEncrypted: encryptEmailCredential(JSON.stringify(tokens)), isEnabled: false, isVerified: true, lastErrorCode: null, configurationVersion: { increment: 1 },
  } });
  if (updated.count !== 1) throw new EmailProviderError('EMAIL_CONFIGURATION_CHANGED', 409, 'CONFIGURATION');
  return { provider: 'MICROSOFT_365', isVerified: true, isEnabled: false, accountEmail: account.email };
}
const refreshing = new Map<string, Promise<Tokens>>();
async function refresh(setting: BrandEmailSetting): Promise<Tokens> {
  const tokens = decodeTokens(setting.oauthDataEncrypted);
  if (tokens.email !== setting.fromEmail.toLowerCase()) throw new EmailProviderError('EMAIL_MICROSOFT_IDENTITY_MISMATCH', 422, 'AUTH');
  if (tokens.expiresAt > Date.now() + 60000) return tokens;
  const refreshKey = `${setting.id}:${setting.configurationVersion}:${createHash('sha256').update(setting.oauthDataEncrypted ?? '').digest('hex')}`;
  if (refreshing.has(refreshKey)) return refreshing.get(refreshKey)!;
  const operation = (async () => {
    try {
      const data = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      const account = await identity(data.access_token, setting.fromEmail, tokens.accountId);
      const next: Tokens = { ...account, accessToken: data.access_token, refreshToken: data.refresh_token || tokens.refreshToken, expiresAt: Date.now() + data.expires_in * 1000 };
      const changed = await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion, oauthDataEncrypted: setting.oauthDataEncrypted }, data: { oauthDataEncrypted: encryptEmailCredential(JSON.stringify(next)) } });
      if (changed.count !== 1) throw new EmailProviderError('EMAIL_CONFIGURATION_CHANGED', 409, 'AUTH');
      return next;
    } catch (error) {
      if (error instanceof EmailProviderError && (error.code === 'EMAIL_MICROSOFT_REAUTHORIZE' || error.code === 'EMAIL_PROVIDER_AUTHORIZATION_FAILED' || error.code === 'EMAIL_MICROSOFT_IDENTITY_MISMATCH')) {
        await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion, oauthDataEncrypted: setting.oauthDataEncrypted }, data: { isEnabled: false, isVerified: false, lastErrorCode: 'EMAIL_MICROSOFT_REAUTHORIZE' } });
      }
      throw error;
    }
  })();
  refreshing.set(refreshKey, operation);
  try { return await operation; } finally { refreshing.delete(refreshKey); }
}
export async function checkMicrosoftIdentity(setting: BrandEmailSetting) {
  const tokens = await refresh(setting);
  return identity(tokens.accessToken, setting.fromEmail, tokens.accountId);
}
export async function sendMicrosoftEmail(setting: BrandEmailSetting, message: EmailMessage) {
  const tokens = await refresh(setting);
  const mail = new MailComposer({ from: { name: setting.fromName, address: setting.fromEmail }, to: message.to, subject: message.subject, html: message.html, text: message.text, disableFileAccess: true, disableUrlAccess: true }).compile();
  const mime = await new Promise<Buffer>((resolve, reject) => mail.build((error, value) => error ? reject(error) : resolve(value)));
  let response: Response;
  try { response = await emailProviderRequest('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'text/plain' }, body: mime.toString('base64') }, true); } catch (error) {
    if (error instanceof EmailProviderError && (error.providerStatus === 401 || error.providerStatus === 403)) {
      await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion }, data: { isEnabled: false, isVerified: false, lastErrorCode: 'EMAIL_MICROSOFT_REAUTHORIZE' } });
    }
    throw error;
  }
  if (response.status !== 202) throw new EmailProviderError('EMAIL_MICROSOFT_ACCEPTANCE_UNKNOWN', 502, 'SEND', true);
  return { messageId: null, accepted: [message.to] };
}
export async function disconnectMicrosoft(brandId: string) {
  const setting = await prisma.brandEmailSetting.findUnique({ where: { brandId } });
  if (!setting || setting.provider !== 'MICROSOFT_365') throw new EmailProviderError('EMAIL_MICROSOFT_NOT_CONFIGURED', 422, 'CONFIGURATION');
  const changed = await prisma.brandEmailSetting.updateMany({ where: { id: setting.id, configurationVersion: setting.configurationVersion }, data: {
    oauthDataEncrypted: null, isEnabled: false, isVerified: false, configurationVersion: { increment: 1 },
  } });
  if (changed.count !== 1) throw new EmailProviderError('EMAIL_CONFIGURATION_CHANGED', 409, 'AUTH');
  return { disconnected: true, localTokensRemoved: true, consentRevocationUrl: 'https://myapplications.microsoft.com/' };
}
