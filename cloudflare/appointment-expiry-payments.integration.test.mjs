import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

async function pending(ctx, method = 'pay-now', startTime = '10:00') {
  const f = ctx.fixture;
  const appointmentId = (await ctx.api(`/api/v1/appointments/${method}`, { body: {
    branchId: f.branchId, serviceId: f.serviceId, staffId: f.staffId, date: f.date, startTime,
  }, status: 201 })).data.appointmentId;
  const { paymentId } = (await ctx.api('/api/v1/payments/stripe/create-intent', { body: { appointmentId }, status: 201 })).data;
  return { appointmentId, paymentId };
}
const control = (ctx, action, appointmentId) => ctx.api('/__policy-test', { body: { appointmentExpiry: { action, appointmentId } } });

for (const method of ['pay-now', 'deposit']) {
  test(`${method} expiry atomically closes pending initial payments and replay is idempotent`, async t => {
    const ctx = await setup(t);
    const { appointmentId, paymentId } = await pending(ctx, method);
    await ctx.direct('/__expire', { id: appointmentId });
    const before = await ctx.state();
    await ctx.cron();
    const after = await ctx.state();
    const parent = after.appointments.find(a => a.id === appointmentId);
    const payment = after.payments.find(p => p.id === paymentId);
    assert.equal(parent.appointmentStatus, 'EXPIRED'); assert.equal(parent.paymentStatus, 'FAILED');
    assert.equal(parent.qrToken, null); assert.equal(parent.holdExpiresAt, null);
    assert.equal(payment.status, 'FAILED'); assert.ok(payment.failedAt); assert.equal(payment.paidAt, null);
    assert.equal(payment.providerPaymentId, before.payments.find(p => p.id === paymentId).providerPaymentId);
    assert.deepEqual(after.wallets, before.wallets); assert.deepEqual(after.ledger, before.ledger);
    assert.ok(after.notifications.some(n => n.type === 'BOOKING_EXPIRED'));
    await ctx.cron(); assert.deepEqual(await ctx.state(), after);
  });

  test(`${method} late Stripe success after expiry still refunds once without reactivation`, async t => {
    const ctx = await setup(t);
    const { appointmentId, paymentId } = await pending(ctx, method);
    await ctx.direct('/__expire', { id: appointmentId }); await ctx.cron();
    assert.equal((await ctx.state()).payments.find(p => p.id === paymentId).status, 'FAILED');
    const event = await ctx.api('/__book-now-provider', { body: { paymentId } });
    await ctx.webhook(event);
    const after = await ctx.state();
    assert.equal(after.appointments.find(a => a.id === appointmentId).appointmentStatus, 'EXPIRED');
    assert.equal(after.appointments.find(a => a.id === appointmentId).paymentStatus, 'REFUNDED');
    assert.equal(after.payments.find(p => p.id === paymentId).status, 'REFUNDED');
    assert.equal(after.refunds.filter(r => r.paymentId === paymentId && r.status === 'SUCCEEDED').length, 1);
    const calls = (await ctx.api('/__policy-test', { body: {} })).providerRefundCreateCalls;
    await ctx.webhook(event); await ctx.webhook({ ...event, id: event.id + '_replay' }); await ctx.cron();
    assert.deepEqual(await ctx.state(), after);
    assert.equal((await ctx.api('/__policy-test', { body: {} })).providerRefundCreateCalls, calls);
  });
}

test('historical EXPIRED/FAILED appointment repairs pending child without duplicate notifications', async t => {
  const ctx = await setup(t);
  const { appointmentId, paymentId } = await pending(ctx, 'deposit');
  await control(ctx, 'legacy', appointmentId);
  const before = await ctx.state();
  assert.equal(before.payments.find(p => p.id === paymentId).status, 'PENDING');
  await ctx.cron(); const after = await ctx.state();
  assert.equal(after.payments.find(p => p.id === paymentId).status, 'FAILED');
  assert.ok(after.payments.find(p => p.id === paymentId).failedAt);
  assert.deepEqual(after.appointments, before.appointments); assert.deepEqual(after.notifications, before.notifications);
  assert.deepEqual(after.wallets, before.wallets); assert.deepEqual(after.ledger, before.ledger);
  await ctx.cron(); assert.deepEqual(await ctx.state(), after);
});

test('expiry preserves settled, captured, remaining, foreign-customer, group and wallet-funding payments', async t => {
  const ctx = await setup(t);
  const { appointmentId, paymentId } = await pending(ctx, 'deposit');
  const guards = await control(ctx, 'guards', appointmentId);
  const active = await pending(ctx, 'pay-now', '12:00');
  await ctx.direct('/__expire', { id: appointmentId });
  await ctx.cron(); const after = await ctx.state();
  assert.equal(after.payments.find(p => p.id === paymentId).status, 'FAILED');
  for (const original of guards.payments) assert.deepEqual(after.payments.find(p => p.id === original.id), original);
  assert.equal(after.appointments.find(a => a.id === active.appointmentId).appointmentStatus, 'PENDING_PAYMENT');
  assert.equal(after.payments.find(p => p.id === active.paymentId).status, 'PENDING');
});

test('a child-payment write failure rolls back appointment expiry and notifications; retry repairs both', async t => {
  const ctx = await setup(t);
  const { appointmentId, paymentId } = await pending(ctx, 'deposit');
  await ctx.direct('/__expire', { id: appointmentId });
  const before = await ctx.state(); await control(ctx, 'block');
  assert.equal((await control(ctx, 'run', appointmentId)).ok, false);
  assert.deepEqual(await ctx.state(), before);
  await control(ctx, 'unblock');
  assert.deepEqual(await control(ctx, 'run', appointmentId), { ok: true, expiredCount: 1 });
  const after = await ctx.state();
  assert.equal(after.appointments.find(a => a.id === appointmentId).paymentStatus, 'FAILED');
  assert.equal(after.payments.find(p => p.id === paymentId).status, 'FAILED');
});

test('late success with uncertain refund outcome reconciles without a second Stripe refund', async t => {
  const ctx = await setup(t);
  const { appointmentId, paymentId } = await pending(ctx, 'deposit');
  await ctx.direct('/__expire', { id: appointmentId }); await ctx.cron();
  await ctx.api('/__policy-test', { body: { refundMode: 'timeout' } });
  const event = await ctx.api('/__book-now-provider', { body: { paymentId } });
  await ctx.webhook(event, 503);
  const calls = (await ctx.api('/__policy-test', { body: {} })).providerRefundCreateCalls;
  await ctx.webhook(event); const after = await ctx.state();
  assert.equal(after.payments.find(p => p.id === paymentId).status, 'REFUNDED');
  assert.equal(after.appointments.find(a => a.id === appointmentId).appointmentStatus, 'EXPIRED');
  assert.equal((await ctx.api('/__policy-test', { body: {} })).providerRefundCreateCalls, calls);
});
