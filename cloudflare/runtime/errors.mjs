import { normalizeError, logUnexpectedError } from '../../src/app/utils/normalize-error.ts';
export function failureResponse(error, source) {
  const { body, unexpected } = normalizeError(error);
  if (unexpected) logUnexpectedError(error, { source });
  return Response.json(body, {
    status: body.statusCode,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  });
}
