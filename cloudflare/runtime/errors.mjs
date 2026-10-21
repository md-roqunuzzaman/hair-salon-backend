import { normalizeError, logUnexpectedError } from '../../src/app/utils/normalize-error.ts';
export function failureResponse(error, source) {
  const { body, unexpected } = normalizeError(error);
  if (unexpected) logUnexpectedError(error, { source });
  return Response.json(body, { status: body.statusCode });
}
