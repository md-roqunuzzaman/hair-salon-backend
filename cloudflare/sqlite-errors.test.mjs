import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSqliteErrorMessage } from './runtime/sqlite-errors.mjs';

test('SQLite constraint metadata survives old and extended Workerd code suffixes', () => {
  const cases = [
    ['UNIQUE constraint failed: Payment.orderNumber', 'SQLITE_CONSTRAINT_UNIQUE'],
    ['PRIMARY KEY constraint failed: User.id', 'SQLITE_CONSTRAINT_PRIMARYKEY'],
    ['UNIQUE constraint failed: Notification.userId, Notification.id', 'SQLITE_CONSTRAINT_UNIQUE'],
    ['NOT NULL constraint failed: Appointment.staffId', 'SQLITE_CONSTRAINT_NOTNULL'],
    ['FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY'],
    ['CHECK constraint failed: valid_amount', 'SQLITE_CONSTRAINT_CHECK'],
  ];
  for (const [message, extended] of cases) {
    for (const suffix of ['', ': SQLITE_CONSTRAINT', `: SQLITE_CONSTRAINT (extended: ${extended})`]) {
      assert.equal(safeSqliteErrorMessage(new Error(message + suffix)), message);
    }
  }
});

test('SQLite safe application/locking errors remain canonical', () => {
  for (const message of ['Money precision exceeded', 'database is locked', 'database is busy']) {
    assert.equal(safeSqliteErrorMessage(new Error(message)), message);
  }
});

test('SQLite unknown errors, SQL, parameters and malformed suffixes remain redacted', () => {
  for (const message of [
    'SELECT private_column FROM User WHERE password = private_value',
    'UNIQUE constraint failed: Payment.orderNumber; SELECT private_token',
    'UNIQUE constraint failed: Payment.orderNumber: SQLITE_CONSTRAINT (extended: private_token)',
    'UNIQUE constraint failed: Payment.orderNumber: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE) private_token',
    'private_value: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
    'provider-token=private_value',
  ]) assert.equal(safeSqliteErrorMessage(new Error(message)), 'SQLite operation failed');
  for (const error of [null, undefined, {}, { message: 123 }]) {
    assert.equal(safeSqliteErrorMessage(error), 'SQLite operation failed');
  }
});
