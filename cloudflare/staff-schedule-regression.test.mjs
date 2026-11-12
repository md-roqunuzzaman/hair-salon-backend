import assert from 'node:assert/strict';
import test from 'node:test';

// All delegates are isolated; never connect to a database or external provider.
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1', STRIPE_SECRET_KEY: 'sk_test_fixture',
  JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3),
});
const { prisma } = await import('../src/app/lib/prisma.ts');
const { Prisma } = await import('../generated/prisma/client.ts');
const { staffService } = await import('../src/app/module/staff/staff.service.ts');
const { notificationService } = await import('../src/app/module/notification/notification.service.ts');

function fixture(t) {
  const entry = { branchId: 'managed', day: 'MONDAY', startTime: '10:00', endTime: '14:00' };
  const state = { managers: [{ branchId: 'managed' }], attempts: 0 };
  const tx = {
    staff: { findUnique: t.mock.fn(async () => ({ userId: 'staff-user', branches: [{ branchId: 'managed' }] })) },
    branchManagerBranch: { findMany: t.mock.fn(async () => state.managers) },
    branch: { findMany: async () => [{ id: 'managed', name: 'Test', status: 'ACTIVE', businessHours: [{ day: 'MONDAY', openTime: '00:00', closeTime: '23:59' }] }] },
    brand: { findFirst: async () => ({ timezone: 'Asia/Hong_Kong' }) },
    appointment: { findMany: async () => [] },
    staffScheduleOverride: { findMany: async () => [] },
    staffSchedule: {
      findMany: async () => [], deleteMany: t.mock.fn(async () => ({ count: 0 })),
      createMany: t.mock.fn(async () => ({ count: 1 })),
    },
  };
  const original = prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  const notify = t.mock.method(notificationService, 'createNotification', async () => ({}));
  const conflict = () => new Prisma.PrismaClientKnownRequestError('Synthetic serialization conflict', { code: 'P2034', clientVersion: 'test' });
  const save = () => staffService.updateStaffSchedule('staff', { schedule: [entry] }, { userId: 'manager', role: 'BRANCH_MANAGER' });
  return { tx, state, save, notify, conflict };
}

test('bulk update retries the complete Serializable transaction and notifies once after commit', async t => {
  const { tx, state, save, notify, conflict } = fixture(t);
  prisma.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    assert.equal(options.timeout, 20000);
    state.attempts++;
    const result = await callback(tx);
    assert.equal(notify.mock.calls.length, 0, 'notification must wait for commit');
    if (state.attempts === 1) throw conflict();
    return result;
  };
  assert.deepEqual(await save(), { staffId: 'staff' });
  assert.equal(state.attempts, 2);
  assert.equal(tx.staff.findUnique.mock.calls.length, 2);
  assert.equal(tx.branchManagerBranch.findMany.mock.calls.length, 2);
  assert.deepEqual(tx.staffSchedule.deleteMany.mock.calls[1].arguments[0].where, { staffId: 'staff', branchId: { in: ['managed'] } });
  assert.equal(notify.mock.calls.length, 1);
});

test('bulk update rechecks revoked manager scope on serialization retry', async t => {
  const { tx, state, save, notify, conflict } = fixture(t);
  prisma.$transaction = async callback => {
    state.attempts++;
    const result = await callback(tx);
    if (state.attempts === 1) {
      state.managers = [];
      throw conflict();
    }
    return result;
  };
  await assert.rejects(save(), error => error.statusCode === 403);
  assert.equal(state.attempts, 2);
  assert.equal(tx.staffSchedule.deleteMany.mock.calls.length, 1);
  assert.equal(notify.mock.calls.length, 0);
});

test('bulk update stops after three serialization failures and returns 409 without notification', async t => {
  const { state, save, notify, conflict } = fixture(t);
  prisma.$transaction = async () => { state.attempts++; throw conflict(); };
  await assert.rejects(save(), error => error.statusCode === 409);
  assert.equal(state.attempts, 3);
  assert.equal(notify.mock.calls.length, 0);
});
