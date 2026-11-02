// Keep the constraint metadata Prisma needs, without exposing SQL or bound data.
// Workerd versions append either a base SQLite code or an extended-code suffix.
export function safeSqliteErrorMessage(error) {
  const raw = typeof error?.message === 'string' ? error.message : '';
  const message = raw.replace(/: SQLITE_[A-Z_]+(?: \(extended: SQLITE_[A-Z_]+\))?\s*$/, '');
  const safe = /^(?:(?:UNIQUE|PRIMARY KEY) constraint failed: [\w., ]+|FOREIGN KEY constraint failed|NOT NULL constraint failed: [\w.]+|CHECK constraint failed(?:: \w+)?|Money precision exceeded|database is (?:locked|busy))$/.test(message);
  return safe ? message : 'SQLite operation failed';
}
