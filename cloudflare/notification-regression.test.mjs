import assert from 'node:assert/strict';
import test from 'node:test';
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', REDIS_URL: 'redis://127.0.0.1:1',
  JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3),
});
const { notificationService } = await import('../src/app/module/notification/notification.service.ts');
const appointment = { id: 'appointment', branchId: 'branch', staffId: 'staff-profile', customerId: 'customer',
  itemName: 'Haircut', itemNameTranslations: { 'zh-HK': { name: '剪髮' } }, date: new Date('2026-10-20'), startTime: '10:00', appointmentStatus: 'RESERVED' };
const payload = { userId: 'customer', type: 'BOOKING_RESERVED', title: 'Booking reserved', message: 'Your private customer message', appointmentId: 'appointment' };
function fixture() {
  const calls = { queries: [], created: [], batches: [] };
  const tx = {
    appointment: { findUnique: async () => appointment },
    user: { findMany: async args => { calls.queries.push(args); return [{ id: 'owner' }, { id: 'manager' }, ...(args.where.OR[2].staffProfile.is.id.in.length ? [{ id: 'staff-user' }, { id: 'staff-user' }] : []), { id: 'customer' }]; } },
    notification: {
      create: async ({ data }) => { calls.created.push(data); return { id: 'customer-notification', ...data }; },
      createMany: async ({ data }) => { calls.batches.push(data); return { count: data.length }; },
    },
  };
  return { tx, calls };
}
test('booking event preserves customer content and scopes team recipients by role, branch and staff user', async () => {
  const { tx, calls } = fixture();
  const result = await notificationService.createNotification(payload, tx);
  assert.equal(result.id, 'customer-notification');
  assert.equal(result.message, payload.message);
  assert.equal(calls.created[0].appointmentId, undefined);
  const query = calls.queries[0].where;
  assert.equal(query.status, 'ACTIVE');
  assert.deepEqual(query.OR, [
    { role: 'BRAND_OWNER' },
    { role: 'BRANCH_MANAGER', managedBranches: { some: { branchId: 'branch' } } },
    { role: 'STAFF', staffProfile: { is: { id: { in: ['staff-profile'] }, status: 'ACTIVE' } } },
  ]);
  assert.deepEqual(calls.batches[0].map(row => row.userId), ['owner', 'manager', 'staff-user']);
  for (const row of calls.batches[0]) {
    assert.doesNotMatch(row.message, /private customer|Your/);
    assert.match(row.message, /appointment.*Haircut/);
    assert.match(row.translations['zh-HK'].message, /剪髮/);
  }
});
test('rescheduling includes the previous and new assigned staff without duplicates', async () => {
  const { tx, calls } = fixture();
  await notificationService.createNotification({ ...payload, type: 'BOOKING_RESCHEDULED', previousStaffId: 'previous-staff' }, tx);
  assert.deepEqual(calls.queries[0].where.OR[2].staffProfile.is.id.in, ['staff-profile', 'previous-staff']);
});
test('private wallet/account notifications keep their original single recipient', async () => {
  const { tx, calls } = fixture();
  await notificationService.createNotification({ userId: 'customer', type: 'WALLET_TOPUP_SUCCESS', title: 'Wallet topup', message: 'Private balance' }, tx);
  assert.equal(calls.created.length, 1); assert.equal(calls.queries.length, 0); assert.equal(calls.batches.length, 0);
});
test('new pending booking notifies management only without inventing a customer notification', async () => {
  const { tx, calls } = fixture();
  tx.appointment.findUnique = async () => ({ ...appointment, appointmentStatus: 'PENDING_PAYMENT' });
  await notificationService.notifyAppointmentTeam('appointment', { type: 'BOOKING_CREATED', title: 'New booking' }, tx);
  assert.equal(calls.created.length, 0); assert.deepEqual(calls.batches[0].map(row => row.userId), ['owner', 'manager']);
  assert.deepEqual(calls.queries[0].where.OR[2].staffProfile.is.id.in, []);
  assert.equal(calls.batches[0][0].translations['zh-HK'].title, '新預約');
});
test('notification persistence errors propagate into the enclosing transaction', async () => {
  const { tx } = fixture();
  tx.notification.createMany = async () => { throw new Error('notification failure'); };
  await assert.rejects(notificationService.createNotification(payload, tx), /notification failure/);
});

test('confirmed voucher booking creation still notifies assigned staff', async () => {
  const { tx, calls } = fixture();
  tx.appointment.findUnique = async () => ({ ...appointment, appointmentStatus: 'CONFIRMED' });
  await notificationService.notifyAppointmentTeam('appointment', { type: 'BOOKING_CREATED', title: 'New booking' }, tx);
  assert.deepEqual(calls.batches[0].map(row => row.userId), ['owner', 'manager', 'staff-user']);
});


test('automatic appointment expiry excludes assigned staff', async () => {
  const { tx, calls } = fixture();
  tx.appointment.findUnique = async () => ({ ...appointment, appointmentStatus: 'EXPIRED' });
  await notificationService.createNotification({ ...payload, type: 'BOOKING_EXPIRED' }, tx);
  assert.deepEqual(calls.batches[0].map(row => row.userId), ['owner', 'manager']);
});

test('group purchase expiry releases inventory and notifies the customer exactly once', async t => {
  const { prisma } = await import('../src/app/lib/prisma.ts');
  const { groupPurchaseExpiryService } = await import('../src/app/module/group-purchase/group-purchase-expiry.service.ts');
  const current = { id: 'purchase', customerId: 'customer', packageId: 'package', quantity: 2, paymentStatus: 'PENDING', reservationExpiresAt: new Date(0) };
  const rows = [];
  let released = 0;
  const delegate = prisma.groupPurchase;
  const original = delegate.findMany;
  delegate.findMany = async () => current.paymentStatus === 'PENDING' ? [{ id: current.id }] : [];
  t.after(() => { delegate.findMany = original; });
  const originalTransaction = prisma.$transaction;
  t.after(() => { prisma.$transaction = originalTransaction; });
  prisma.$transaction = async callback => callback({
    groupPurchase: {
      findUnique: async () => current,
      updateMany: async () => { current.paymentStatus = 'FAILED'; return { count: 1 }; },
    },
    package: { updateMany: async () => { released += current.quantity; return { count: 1 }; } },
    notification: { create: async ({ data }) => { rows.push(data); return data; } },
  });
  assert.equal((await groupPurchaseExpiryService.expirePendingGroupPurchases()).expiredCount, 1);
  assert.equal((await groupPurchaseExpiryService.expirePendingGroupPurchases()).expiredCount, 0);
  assert.equal(released, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, 'customer');
  assert.equal(rows[0].type, 'GROUP_PURCHASE_EXPIRED');
});
