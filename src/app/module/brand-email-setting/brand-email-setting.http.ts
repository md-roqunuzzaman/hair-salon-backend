import { EmailProviderError } from './brand-email-setting.errors.js';

// Never retry a mutating request: a timed-out send may already be accepted.
export async function emailProviderRequest(url: string, init: RequestInit, uncertain = false) {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new EmailProviderError('EMAIL_PROVIDER_NETWORK_FAILED', 502, 'SEND', uncertain); }
  if (!response.ok) {
    const code = response.status === 429 ? 'EMAIL_PROVIDER_RATE_LIMITED' : response.status === 401 || response.status === 403 ? 'EMAIL_PROVIDER_AUTHORIZATION_FAILED' : 'EMAIL_PROVIDER_REQUEST_FAILED';
    throw new EmailProviderError(code, response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 422 : 502, 'SEND', uncertain && (response.status >= 500 || response.status === 408), response.status);
  }
  return response;
}
