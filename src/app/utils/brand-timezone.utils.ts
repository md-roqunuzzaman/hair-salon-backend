import { AppError } from "./app-error.js";

export const getDateInTimezone = (
  timezone: string,
  now: Date = new Date(),
): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
};

export const createDateTimeInTimezone = (
  date: string,
  time: string,
  timezone: string,
): Date => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const targetUTC = Date.UTC(year, month - 1, day, hour, minute);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) ||
      !Number.isFinite(targetUTC) || new Date(targetUTC).toISOString().slice(0, 16) !== `${date}T${time}`) {
    throw new AppError("Invalid calendar date or time", 400);
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const getLocalAsUTC = (timestamp: number): number => {
    const parts = formatter.formatToParts(new Date(timestamp));

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
  };

  let timestamp = targetUTC;

  for (let i = 0; i < 4; i++) {
    const difference = targetUTC - getLocalAsUTC(timestamp);

    if (difference === 0) {
      break;
    }

    timestamp += difference;
  }

  if (getLocalAsUTC(timestamp) !== targetUTC) {
    throw new AppError(
      "Selected local time does not exist in this timezone",
      400,
    );
  }

  // The stored wall-clock fields have no UTC offset/fold. Never silently choose
  // one of two instants during a repeated DST hour.
  const candidates = new Set<number>();
  for (const offset of [-36, -12, 0, 12, 36]) {
    const probe = timestamp + offset * 3600000;
    const candidate = targetUTC - (getLocalAsUTC(probe) - probe);
    if (getLocalAsUTC(candidate) === targetUTC) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new AppError("Selected local time is ambiguous in this timezone", 400);
  return new Date(timestamp);
};

export const assertTimezoneDuration = (date: string, start: string, end: string, durationMinutes: number, timezone: string): void => {
  const elapsed = createDateTimeInTimezone(date, end, timezone).getTime() - createDateTimeInTimezone(date, start, timezone).getTime();
  if (elapsed !== durationMinutes * 60000) throw new AppError("Selected interval crosses a timezone transition", 400);
};

// Date-only keys remain UTC-midnight calendar labels; only instant filters use this.
export const localDateBoundary = (date: string, timezone: string, end = false): Date => {
  if (!end) return createDateTimeInTimezone(date, "00:00", timezone);
  const key = new Date(`${date}T00:00:00.000Z`);
  key.setUTCDate(key.getUTCDate() + 1);
  return new Date(createDateTimeInTimezone(key.toISOString().slice(0, 10), "00:00", timezone).getTime() - 1);
};
