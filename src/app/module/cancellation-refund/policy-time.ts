import { AppError } from '../../utils/app-error.js';

const fields = [
  ['minimumCancellationHours', 'minimumCancellationMinutes'],
  ['restorationMinimumHours', 'restorationMinimumMinutes'],
  ['minimumHoursBefore', 'minimumMinutesBefore'],
  ['minimumHoursBeforeAppointment', 'minimumMinutesBeforeAppointment'],
  ['minimumHoursAfterPurchase', 'minimumMinutesAfterPurchase'],
] as const;

// Old financial/booking snapshots remain immutable. Normalize a detached view,
// using explicit field names so minute snapshots are never multiplied twice.
export function policyTimeMinutes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(policyTimeMinutes) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, policyTimeMinutes(item)]),
  );
  for (const [old, current] of fields) {
    if (!(old in result)) continue;
    const hours = result[old];
    const minutes = typeof hours === 'number' ? hours * 60 : NaN;
    if (!Number.isSafeInteger(minutes) || minutes < 0 ||
        (current in result && result[current] !== minutes)) {
      throw new AppError('INVALID_POLICY_TIME_UNIT', 409);
    }
    result[current] = minutes;
    delete result[old];
  }
  return result as T;
}
