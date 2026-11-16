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
    id: 'synthetic', customerId: 'customer', date: new Date('2026-11-16T00:00:00Z'),
    startTime: '01:00', endTime: '02:00', timezone: 'Asia/Hong_Kong',
    appointmentStatus: 'CONFIRMED', paymentStatus: 'PAID', qrVerifiedAt: null,
    bookingMethod: 'PAY_NOW', groupPurchaseId: null, ...overrides,
  };
  const state = { current: row, rows: [row] };
  const replace = (target, key, value) => {
    const old = target[key]; target[key] = value; t.after(() => { target[key] = old; });
  };
  replace(prisma.appointment, 'findMany', async ({ where, take }) => state.rows.filter(r =>
    ['RESERVED', 'CONFIRMED'].includes(r.appointmentStatus) && r.qrVerifiedAt === null &&
    r.date <= where.date.lte && (!where.id || r.id > where.id.gt),
  ).slice(0, take));
  replace(prisma.appointment, 'findUnique', async ({ where }) => state.rows.find(row => row.id === where.id));
  replace(prisma, '$transaction', async (callback, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    return callback({ appointment: {
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
