import { AppError } from '../../utils/app-error.js';

export type EmailStage = 'CONFIGURATION' | 'DNS' | 'CONNECT' | 'TLS' | 'AUTH' | 'SEND' | 'ACCEPTED';
export class EmailProviderError extends AppError {
  sourceCode?: string;
  causeCode?: string;
  constructor(public readonly code: string, status: number, public readonly stage: EmailStage,
    public readonly deliveryUncertain = false, public readonly providerStatus?: number) {
    super(code, status);
  }
}

// Deliberately never include raw messages, SMTP responses, URLs or token bodies.
export function safeEmailError(error: unknown): EmailProviderError {
  if (error instanceof EmailProviderError) return error;
  const e = (error ?? {}) as { code?: string; responseCode?: number; command?: string; stage?: EmailStage; cause?: {code?: string}; deliveryUncertain?: boolean };
  const code = String(e.code ?? e.cause?.code ?? '');
  const stages: string[] = ['CONFIGURATION','DNS','CONNECT','TLS','AUTH','SEND','ACCEPTED'];
  const stage: EmailStage = e.stage && stages.includes(e.stage) ? e.stage : e.command?.startsWith('AUTH') || code === 'EAUTH' ? 'AUTH' : e.command === 'CONN' ? 'CONNECT' : 'SEND';
  const known = new Set(['ESOCKET','EAUTH','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','EPIPE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SMTP_535']);
  const result = (name: string, status: number, at: EmailStage, uncertain = false) => {
    const safe = new EmailProviderError(name, status, at, uncertain, Number.isInteger(e.responseCode) ? e.responseCode : undefined);
    safe.sourceCode = known.has(e.code ?? '') ? e.code : undefined;
    safe.causeCode = known.has(e.cause?.code ?? '') ? e.cause!.code : undefined;
    return safe;
  };
  if (code === 'EAUTH' || code === 'SMTP_535' || e.responseCode === 535) return result('EMAIL_AUTHENTICATION_FAILED', 422, 'AUTH');
  if (e.responseCode && e.responseCode >= 500 && e.responseCode <= 599) return result('EMAIL_PROVIDER_REJECTED', 422, stage);
  if (e.responseCode && e.responseCode >= 400 && e.responseCode <= 499) return result('EMAIL_PROVIDER_TEMPORARY_FAILURE', 502, stage);
  if (/CERT|TLS|SSL/.test(code + String(e.cause?.code ?? ''))) return result('EMAIL_TLS_FAILED', 502, 'TLS');
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return result('EMAIL_DNS_FAILED', 502, 'DNS');
  if (['ETIMEDOUT','ESOCKET','ECONNREFUSED','ECONNRESET','EPIPE'].includes(code) || stage === 'CONNECT') return result('EMAIL_CONNECTION_FAILED', 502, stage, e.deliveryUncertain ?? stage === 'SEND');
  if (stage === 'TLS') return result('EMAIL_TLS_FAILED', 502, 'TLS');
  return result('EMAIL_PROVIDER_FAILED', 502, stage, stage === 'SEND' || !!e.deliveryUncertain);
}

export function logEmailFailure(provider: string, error: unknown, configuration?: { smtpHost: string | null; smtpPort: number | null; smtpSecure: boolean | null }) {
  const e = safeEmailError(error);
  console.error('[Merchant Email]', { provider, code: e.code, sourceCode: e.sourceCode, causeCode: e.causeCode, stage: e.stage, deliveryUncertain: e.deliveryUncertain, providerStatus: e.providerStatus,
    smtpHost: configuration?.smtpHost, smtpPort: configuration?.smtpPort, implicitTls: configuration?.smtpSecure });
  return e;
}
