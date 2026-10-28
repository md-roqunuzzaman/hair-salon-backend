import nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import type { BrandEmailSetting } from '../../../generated/prisma/client.js';
import { decryptEmailCredential } from '../utils/email-credential-crypto.js';
import { validateSmtpSetting, type EmailMessage } from '../module/brand-email-setting/brand-email-setting.transport.js';
import { EmailProviderError, safeEmailError } from '../module/brand-email-setting/brand-email-setting.errors.js';
export const customSmtpSupported = true;

// Custom SMTP is IPv4-only and pins the vetted resolved IP to the socket.
// Deny reserved/special ranges, not just RFC1918. No second DNS resolution occurs.
export function isPublicSmtpIPv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88) ||
    a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0);
}

export async function resolveCustomSmtp(host: string, resolver: (host: string) => Promise<{address: string}[]> = host => lookup(host, { all: true })) {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) throw new EmailProviderError('EMAIL_UNSAFE_SMTP_HOST', 422, 'DNS');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([resolver(host), new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new EmailProviderError('EMAIL_DNS_TIMEOUT', 502, 'DNS')), 5000);
  })]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(a => !isPublicSmtpIPv4(a.address))) throw new EmailProviderError('EMAIL_UNSAFE_SMTP_ADDRESS', 422, 'DNS');
  return addresses[0].address;
}

export async function sendMerchantSmtp(setting: BrandEmailSetting, message: EmailMessage, verifyOnly = false) {
  validateSmtpSetting(setting);
  let password: string;
  try { password = decryptEmailCredential(setting.encryptedCredential!); }
  catch { throw new EmailProviderError('EMAIL_CREDENTIAL_DECRYPTION_FAILED', 503, 'CONFIGURATION'); }
  let pinned: string | undefined;
  if (setting.provider === 'CUSTOM_SMTP') pinned = await resolveCustomSmtp(setting.smtpHost!);
  if (![465, 587, 2525].includes(setting.smtpPort!) || (setting.smtpPort === 465 && !setting.smtpSecure)) throw new EmailProviderError('EMAIL_UNSAFE_SMTP_TLS', 422, 'CONFIGURATION');
  const transport = nodemailer.createTransport({
    host: setting.smtpHost!, port: setting.smtpPort!, secure: setting.smtpSecure!, requireTLS: true,
    auth: { user: setting.smtpUsername!, pass: password },
    tls: { rejectUnauthorized: true, servername: setting.smtpHost! },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
    ...(pinned ? { getSocket: (_options: unknown, callback: (error: Error | null, value?: object) => void) => {
      let settled = false;
      const socket = setting.smtpSecure
        ? tls.connect({ host: pinned, port: setting.smtpPort!, servername: setting.smtpHost!, rejectUnauthorized: true })
        : net.connect({ host: pinned, port: setting.smtpPort! });
      const finish = (error: Error | null) => { if (settled) return; settled = true; clearTimeout(timer); callback(error, error ? undefined : { connection: socket, secured: !!setting.smtpSecure }); };
      const timer = setTimeout(() => { socket.destroy(); finish(new EmailProviderError('EMAIL_CONNECTION_TIMEOUT', 502, 'CONNECT')); }, 15000);
      socket.once(setting.smtpSecure ? 'secureConnect' : 'connect', () => finish(null));
      socket.once('error', error => {
        if (settled) return;
        const code = (error as NodeJS.ErrnoException).code;
        finish(safeEmailError(Object.assign(error, { stage: ['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(code ?? '') ? 'CONNECT' : setting.smtpSecure ? 'TLS' : 'CONNECT', deliveryUncertain: false })));
      });
    } } : {}),
  });
  try {
    if (verifyOnly) { await transport.verify(); return { messageId: null, accepted: [] as string[] }; }
    const result = await transport.sendMail({ ...message, from: { name: setting.fromName, address: setting.fromEmail } });
    if (!result.accepted?.length) throw new EmailProviderError('EMAIL_NOT_ACCEPTED', 502, 'SEND');
    return { messageId: result.messageId, accepted: result.accepted.map(String) };
  } catch (error) { throw safeEmailError(error); }
  finally { transport.close(); }
}
