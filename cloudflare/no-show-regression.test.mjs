import assert from 'node:assert/strict';
import test from 'node:test';
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', REDIS_URL: 'redis://127.0.0.1:1',
  STRIPE_SECRET_KEY: 'sk_test_fixture', JWT_ACCESS_SECRET: 'synthetic-access-secret'.repeat(3), JWT_REFRESH_SECRET: 'synthetic-refresh-secret'.repeat(3),
});
const { prisma } = await import('../src/app/lib/prisma.ts');
const { appointmentService } = await import('../src/app/module/appointment/appointment.service.ts');
const { notificationService } = await import('../src/app/module/notification/notification.service.ts');
const { auditLogService } = await import('../src/app/module/auditLog/auditLog.service.ts');

function fixture(t, instant, overrides = {}) {
  const OriginalDate = Date;
  t.mock.method(globalThis, 'Date', class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return new OriginalDate(instant).getTime(); }
  });
  const row = {
    id: 'synthetic', branchId: 'synthetic-branch', customerId: 'customer', date: new Date('2026-11-16T00:00:00Z'),
    startTime: '01:00', endTime: '02:00', timezone: 'Asia/Hong_Kong',
    appointmentStatus: 'CONFIRMED', paymentStatus: 'PAID', qrVerifiedAt: null,
    bookingMethod: 'PAY_NOW', groupPurchaseId: null, ...overrides,
  };
  // Original tests explicitly exercise end-based deadlines. New policy tests
  // below select start-based/default behavior without changing those assertions.
  const state = { current: row, rows: [row], policyRule: 'BEFORE_END_TIME', currentPolicyRule: 'BEFORE_END_TIME' };
  const replace = (target, key, value) => {
    const old = target[key]; target[key] = value; t.after(() => { target[key] = old; });
  };
  replace(prisma.branchBookingPolicy, 'findUnique', async ({ where, select }) => {
    assert.equal(where.branchId, row.branchId);
    assert.deepEqual(select, { qrVerificationRule: true });
    return state.policyRule ? { qrVerificationRule: state.policyRule } : null;
  });
  replace(prisma.appointment, 'findMany', async ({ where, take }) => state.rows.filter(r =>
    ['RESERVED', 'CONFIRMED'].includes(r.appointmentStatus) && r.qrVerifiedAt === null &&
    r.date <= where.date.lte && (!where.id || r.id > where.id.gt),
  ).slice(0, take));
  replace(prisma.appointment, 'findUnique', async ({ where }) => state.rows.find(row => row.id === where.id));
  replace(prisma, '$transaction', async (callback, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    return callback({ branchBookingPolicy: {
      findUnique: async ({ where, select }) => {
        assert.equal(where.branchId, state.current.branchId);
        assert.deepEqual(select, { qrVerificationRule: true });
        return state.currentPolicyRule ? { qrVerificationRule: state.currentPolicyRule } : null;
      },
    }, appointment: {
      findUnique: async ({ where }) => state.rows.length === 1 ? state.current : state.rows.find(row => row.id === where.id),
      updateMany: async ({ where, data }) => {
        const current = state.rows.find(row => row.id === where.id);
        if (current.qrVerifiedAt !== null) return { count: 0 };
        Object.assign(current, data); return { count: 1 };
      },
    } });
  });
  const notification = t.mock.method(notificationService, 'createNotification', async () => ({}));
  const audit = t.mock.method(auditLogService, 'createAuditLog', async () => ({}));
  // The service logs per-row errors and continues. Such failures must never
  // silently make a negative eligibility assertion pass in this mocked suite.
  const errors = t.mock.method(console, 'error', () => {});
  t.after(() => assert.equal(errors.mock.calls.length, 0, 'Unexpected no-show error; check fixture delegate coverage'));
  return { row, state, notification, audit };
}

test('HK early morning local date is included and exact end+15-minute boundary is eligible', async t => {
  const f = fixture(t, '2026-11-15T18:15:00.000Z');
  assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: 1 });
  assert.equal(f.row.appointmentStatus, 'NO_SHOW');
  assert.equal(f.notification.mock.calls.length, 1);
  assert.equal(f.audit.mock.calls.length, 1);
});

test('no-show never marks before the 15-minute grace period', async t => {
  const f = fixture(t, '2026-11-15T18:14:59.999Z');
  assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: 0 });
  assert.equal(f.row.appointmentStatus, 'CONFIRMED');
  assert.equal(f.notification.mock.calls.length, 0);
});

test('no-show transaction rechecks check-in and rescheduled deadline', async t => {
  const f = fixture(t, '2026-11-15T18:15:00.000Z');
  f.state.current = { ...f.row, qrVerifiedAt: new Date() };
  assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: 0 });
  f.state.current = { ...f.row, endTime: '03:00' };
  assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: 0 });
  assert.equal(f.notification.mock.calls.length, 0);
  assert.equal(f.audit.mock.calls.length, 0);
});

test('no-show keyset batching processes more than 100 eligible rows without skipping', async t => {
  const f = fixture(t, '2026-11-15T18:15:00.000Z');
  f.state.rows = Array.from({ length: 102 }, (_, index) => ({ ...f.row, id: `synthetic-${String(index).padStart(3, '0')}` }));
  assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: 102 });
  assert.equal(f.notification.mock.calls.length, 102);
  assert.equal(f.audit.mock.calls.length, 102);
});

for (const [rule, instant, expectedCount] of [
  ['BEFORE_START_TIME', '2026-11-15T17:14:59.999Z', 0],
  ['BEFORE_START_TIME', '2026-11-15T17:15:00.000Z', 1],
  ['BEFORE_END_TIME', '2026-11-15T18:14:59.999Z', 0],
  ['BEFORE_END_TIME', '2026-11-15T18:15:00.000Z', 1],
]) {
  test(`${rule} uses its exact 15-minute boundary at ${instant}`, async t => {
    const f = fixture(t, instant);
    f.state.policyRule = rule;
    f.state.currentPolicyRule = rule;
    assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: expectedCount });
    assert.equal(f.row.appointmentStatus, expectedCount ? 'NO_SHOW' : 'CONFIRMED');
    assert.equal(f.row.paymentStatus, 'PAID');
    assert.equal(f.notification.mock.calls.length, expectedCount);
    assert.equal(f.audit.mock.calls.length, expectedCount);
    if (expectedCount) {
      assert.ok(f.row.noShowReason.includes(rule === 'BEFORE_START_TIME' ? 'appointment start time' : 'appointment end time'));
      const metadata = f.audit.mock.calls[0].arguments[0].metadata;
      assert.equal(metadata.qrVerificationRule, rule);
      assert.equal(metadata.noShowReferenceAt, rule === 'BEFORE_START_TIME' ? '2026-11-15T17:00:00.000Z' : '2026-11-15T18:00:00.000Z');
      assert.equal(metadata.noShowEligibleAt, instant);
    }
  });
}

test('changed branch policy is rechecked transactionally before marking no-show', async t => {
  const f = fixture(t, '2026-11-15T17:15:00.000Z');
  f.state.policyRule = 'BEFORE_START_TIME';
  f.state.currentPolicyRule = 'BEFORE_END_TIME';
  assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: 0 });
  assert.equal(f.row.appointmentStatus, 'CONFIRMED');
  assert.equal(f.notification.mock.calls.length, 0);
  assert.equal(f.audit.mock.calls.length, 0);
});

test('missing branch policy defaults to BEFORE_START_TIME in both reads', async t => {
  const f = fixture(t, '2026-11-15T17:15:00.000Z');
  f.state.policyRule = null;
  f.state.currentPolicyRule = null;
  assert.deepEqual(await appointmentService.autoMarkNoShowAppointments(), { noShowCount: 1 });
  assert.equal(f.row.appointmentStatus, 'NO_SHOW');
  assert.equal(f.notification.mock.calls.length, 1);
  assert.equal(f.audit.mock.calls.length, 1);
  assert.equal(f.audit.mock.calls[0].arguments[0].metadata.qrVerificationRule, 'BEFORE_START_TIME');
});
