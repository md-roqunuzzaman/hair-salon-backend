import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './test-support/public-worker.mjs';

async function context(t) {
  const ctx = await setup(t, 'true');
  await ctx.api('/__feature-license-test', { body: { features: {
    GROUP_BUYING: { enabled: true, startsAt: '2020-01-01T00:00:00Z' },
    WALLET: { enabled: true, startsAt: '2020-01-01T00:00:00Z' },
  } } });
  return Object.assign(ctx, {
    control: body => ctx.api('/__group-initial-test', { body }),
    create: async () => (await ctx.api('/api/v1/group-purchases', {
      body: { packageId: ctx.fixture.packageId, quantity: 1, purchaseFlow: 'BUY_NOW_BOOK_LATER' }, status: 201,
    })).data.purchaseId,
    intent: async purchaseId => (await ctx.api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId }, status: 201 })).data,
    expire: purchaseId => ctx.api('/__book-now-expire', { body: { purchaseId } }),
  });
}
const group = (state, id) => state.purchases.find(g => g.id === id);
const payment = (state, id) => state.payments.find(p => p.id === id);

test('BUY_NOW_BOOK_LATER Stripe settlement reuses one intent and duplicate webhooks cannot sell twice', async t => {
  const c = await context(t), id = await c.create(), first = await c.intent(id);
  const second = await c.intent(id); assert.equal(first.paymentId, second.paymentId);
  const event = await c.api('/__book-now-provider', { body: { paymentId: first.paymentId } });
  await c.webhook(event); const after = await c.state();
  assert.equal(group(after, id).paymentStatus, 'PAID'); assert.equal(payment(after, first.paymentId).status, 'PAID');
  assert.equal(group(after, id).settledPaymentId, first.paymentId);
  await c.webhook(event); await c.webhook({ ...event, id: event.id + '_duplicate' }); await c.cron();
  assert.deepEqual(await c.state(), after);
});

test('unpaid expiry cancels Stripe before failing the child; cancellation receipt makes repeat cleanup a no-op', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  const before = await c.state(), pi = payment(before, p.paymentId).providerPaymentId;
  await c.expire(id); await c.cron(); const after = await c.state();
  assert.equal(group(after, id).paymentStatus, 'FAILED'); assert.equal(group(after, id).purchasedAt, null);
  assert.equal(payment(after, p.paymentId).status, 'FAILED'); assert.ok(payment(after, p.paymentId).failedAt);
  const provider = await c.control({ action: 'provider' });
  assert.equal(provider.intents.find(x => x.id === pi).status, 'canceled'); assert.equal(provider.cancelCalls, 1);
  await c.cron(); assert.deepEqual(await c.state(), after);
  assert.deepEqual(await c.control({ action: 'provider' }), provider);
  await c.api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 409 });
});

test('processing payment remains pending after parent expiry; late success is refunded without reactivation', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  const pi = payment(await c.state(), p.paymentId).providerPaymentId;
  await c.control({ action: 'provider', intentId: pi, status: 'processing' });
  await c.expire(id); await c.cron(); const expired = await c.state();
  assert.equal(group(expired, id).paymentStatus, 'FAILED'); assert.equal(payment(expired, p.paymentId).status, 'PENDING');
  assert.equal((await c.control({ action: 'provider' })).cancelCalls, 0);
  const event = await c.api('/__book-now-provider', { body: { paymentId: p.paymentId } });
  await c.webhook(event); const refunded = await c.state();
  assert.equal(group(refunded, id).purchasedAt, null); assert.equal(payment(refunded, p.paymentId).status, 'REFUNDED');
  assert.equal(refunded.packages[0].soldQuantity, 0);
  await c.webhook({ ...event, id: event.id + '_replay' }); await c.cron(); assert.deepEqual(await c.state(), refunded);
});

test('confirmed Stripe cancellation webhook closes the child idempotently and permits a new safe retry', async t => {
  const c = await context(t), id = await c.create(), first = await c.intent(id);
  const pi = payment(await c.state(), first.paymentId).providerPaymentId;
  const { event } = await c.control({ action: 'provider', intentId: pi, status: 'canceled' });
  await c.webhook(event); const after = await c.state(); assert.equal(payment(after, first.paymentId).status, 'FAILED');
  await c.webhook(event); assert.deepEqual(await c.state(), after);
  const retry = await c.intent(id); assert.notEqual(retry.paymentId, first.paymentId);
  assert.equal((await c.control({ action: 'provider' })).intents.filter(x => x.status !== 'canceled').length, 1);
});

test('retry after a failed attempt cancels its still-payable old intent before creating another', async t => {
  const c = await context(t), id = await c.create(), first = await c.intent(id);
  await c.webhook(await c.api('/__book-now-provider', { body: { paymentId: first.paymentId, failed: true } }));
  assert.equal(group(await c.state(), id).paymentStatus, 'PENDING');
  const retry = await c.intent(id); assert.notEqual(retry.paymentId, first.paymentId);
  const provider = await c.control({ action: 'provider' });
  assert.equal(provider.intents.filter(x => x.status !== 'canceled').length, 1);
  assert.equal(provider.cancelCalls, 1);
});

for (const failFirst of [false, true]) test(`Stripe to Wallet switch closes ${failFirst ? 'failed but retryable' : 'pending'} intent before debiting once`, async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  if (failFirst) await c.webhook(await c.api('/__book-now-provider', { body: { paymentId: p.paymentId, failed: true } }));
  const before = await c.state();
  await c.api(`/api/v1/group-purchases/${id}/pay-with-wallet`, { body: { useBonus: false } });
  const after = await c.state(); assert.equal(group(after, id).paymentStatus, 'PAID');
  assert.equal(payment(after, p.paymentId).status, 'FAILED');
  assert.equal(after.payments.filter(p => p.groupPurchaseId === id && p.status === 'PAID').length, 1);
  assert.ok(Number(after.wallets[0].paidBalance) < Number(before.wallets[0].paidBalance));
  assert.equal((await c.control({ action: 'provider' })).intents[0].status, 'canceled');
  await c.api(`/api/v1/group-purchases/${id}/pay-with-wallet`, { body: { useBonus: false }, status: 409 });
  assert.deepEqual(await c.state(), after);
});

test('processing old failed intent blocks both Stripe retry and Wallet switching without another charge', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  await c.webhook(await c.api('/__book-now-provider', { body: { paymentId: p.paymentId, failed: true } }));
  const pi = payment(await c.state(), p.paymentId).providerPaymentId;
  await c.control({ action: 'provider', intentId: pi, status: 'processing' }); const before = await c.state();
  await c.api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 409 });
  await c.api(`/api/v1/group-purchases/${id}/pay-with-wallet`, { body: { useBonus: false }, status: 409 });
  assert.deepEqual(await c.state(), before); assert.equal((await c.control({ action: 'provider' })).intents.length, 1);
});

test('multiple historical active intents are reduced to one before a Stripe retry response', async t => {
  const c = await context(t), id = await c.create(), first = await c.intent(id);
  await c.control({ action: 'duplicate', purchaseId: id });
  assert.equal((await c.control({ action: 'provider' })).intents.length, 2);
  assert.equal((await c.intent(id)).paymentId, first.paymentId);
  assert.equal((await c.control({ action: 'provider' })).intents.filter(x => x.status !== 'canceled').length, 1);
});

test('capture winning cancellation race settles Stripe and prevents a Wallet debit', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id), before = await c.state();
  await c.control({ action: 'provider', cancelMode: 'capture' });
  await c.api(`/api/v1/group-purchases/${id}/pay-with-wallet`, { body: { useBonus: false }, status: 409 });
  const after = await c.state(); assert.equal(group(after, id).paymentStatus, 'PAID');
  assert.equal(payment(after, p.paymentId).status, 'PAID'); assert.deepEqual(after.wallets, before.wallets);
  assert.deepEqual(after.ledger, before.ledger);
});

test('cancellation timeout is resolved by retrieval, without guessing failure or duplicating the debit', async t => {
  const c = await context(t), id = await c.create(); await c.intent(id);
  await c.control({ action: 'provider', cancelMode: 'timeout' });
  await c.api(`/api/v1/group-purchases/${id}/pay-with-wallet`, { body: { useBonus: false } });
  assert.equal((await c.state()).ledger.length, 1);
  assert.equal((await c.control({ action: 'provider' })).cancelCalls, 1);
});

test('Stripe cancellation followed by a local write failure remains recoverable without a second inventory release', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  await c.expire(id); await c.control({ action: 'block' });
  assert.equal((await c.control({ action: 'run' })).ok, false);
  const partial = await c.state(); assert.equal(group(partial, id).paymentStatus, 'FAILED');
  assert.equal(payment(partial, p.paymentId).status, 'PENDING');
  assert.equal((await c.control({ action: 'provider' })).intents[0].status, 'canceled');
  await c.control({ action: 'unblock' }); assert.equal((await c.control({ action: 'run' })).ok, true);
  const after = await c.state(); assert.equal(payment(after, p.paymentId).status, 'FAILED');
  assert.deepEqual(after.packages, partial.packages); assert.deepEqual(after.notifications, partial.notifications);
});

test('provider outage leaves child pending and surfaces retryable reconciliation failure', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  await c.expire(id); await c.control({ action: 'provider', failRead: true });
  assert.equal((await c.control({ action: 'run' })).ok, false);
  assert.equal(payment(await c.state(), p.paymentId).status, 'PENDING');
  await c.control({ action: 'provider', failRead: false });
  assert.equal((await c.control({ action: 'run' })).ok, true);
  assert.equal(payment(await c.state(), p.paymentId).status, 'FAILED');
});

test('inline voucher reservation expiry and historical FAILED/PENDING rows are reconciled by the next cleanup', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  await c.expire(id); await c.create();
  assert.equal(group(await c.state(), id).paymentStatus, 'FAILED');
  assert.equal(payment(await c.state(), p.paymentId).status, 'PENDING');
  await c.cron(); assert.equal(payment(await c.state(), p.paymentId).status, 'FAILED');
  const historical = await c.create(), old = await c.intent(historical);
  await c.control({ action: 'legacyFailed', purchaseId: historical }); await c.cron();
  assert.equal(payment(await c.state(), old.paymentId).status, 'FAILED');
});

test('concurrent expiry and duplicate late successes release inventory and refund only once', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  await c.expire(id);
  const event = await c.api('/__book-now-provider', { body: { paymentId: p.paymentId } });
  await Promise.all([c.cron(), c.webhook(event), c.webhook({ ...event, id: event.id + '_concurrent' })]);
  const after = await c.state(); assert.equal(group(after, id).purchasedAt, null);
  assert.equal(payment(after, p.paymentId).status, 'REFUNDED');
  assert.equal(after.refunds.filter(r => r.paymentId === p.paymentId && r.status === 'SUCCEEDED').length, 1);
  assert.equal(after.packages[0].reservedQuantity, 0); assert.equal(after.packages[0].soldQuantity, 0);
});

for (const method of ['PAY_NOW', 'DEPOSIT']) test(`historical DIRECT_BOOK ${method} expires safely; disabled creation stays disabled`, async t => {
  const c = await context(t), customerId = (await c.state()).wallets[0].customerId;
  const { purchaseId } = await c.control({ action: 'legacy', ...c.fixture, customerId, bookingMethod: method });
  const p = await c.intent(purchaseId); await c.expire(purchaseId); await c.cron();
  const after = await c.state(); assert.equal(group(after, purchaseId).paymentStatus, 'FAILED');
  assert.equal(payment(after, p.paymentId).status, 'FAILED');
  assert.equal(after.appointments.find(a => a.groupPurchaseId === purchaseId).appointmentStatus, 'EXPIRED');
  for (const purchaseFlow of ['DIRECT_BOOK', 'BUY_NOW_BOOK_NOW']) await c.api('/api/v1/group-purchases', {
    body: { packageId: c.fixture.packageId, quantity: 1, purchaseFlow, bookingMethod: method }, status: 400,
  });
});

test('existing group financial safety checks run with an explicitly licensed disposable fixture', async t => {
  const c = await context(t);
  const result = await c.api('/__group-safety');
  assert.ok(result.passed.length >= 50);
  t.diagnostic(`${result.passed.length} existing real SQLite financial checks passed`);
});

test('uncertain intent creation preserves one stable attempt, blocks Wallet and retries the same provider key', async t => {
  const c = await context(t), id = await c.create();
  await c.control({ action: 'provider', createTimeout: true });
  await c.api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 502 });
  const before = await c.state(), attempt = before.payments.find(p => p.groupPurchaseId === id);
  assert.equal(attempt.status, 'PENDING'); assert.equal(attempt.providerPaymentId, null);
  const originalIntent = (await c.control({ action: 'provider' })).intents[0].id;
  await c.api(`/api/v1/group-purchases/${id}/pay-with-wallet`, { body: { useBonus: false }, status: 409 });
  assert.deepEqual((await c.state()).wallets, before.wallets);
  const retry = await c.intent(id); assert.equal(retry.paymentId, attempt.id);
  assert.equal(payment(await c.state(), retry.paymentId).providerPaymentId, originalIntent);
  assert.equal((await c.control({ action: 'provider' })).intents.length, 1);
});

test('cleanup recovers a missing success webhook and an uncertain refund without submitting another refund', async t => {
  const c = await context(t), id = await c.create(), p = await c.intent(id);
  await c.expire(id);
  const pi = payment(await c.state(), p.paymentId).providerPaymentId;
  await c.control({ action: 'provider', intentId: pi, status: 'succeeded' }); // No webhook is delivered.
  await c.api('/__policy-test', { body: { refundMode: 'timeout' } });
  assert.equal((await c.control({ action: 'run' })).ok, false);
  assert.equal(payment(await c.state(), p.paymentId).status, 'PAID');
  const calls = (await c.api('/__policy-test', { body: {} })).providerRefundCreateCalls;
  assert.equal((await c.control({ action: 'run' })).ok, true);
  const after = await c.state(); assert.equal(payment(after, p.paymentId).status, 'REFUNDED');
  assert.equal(group(after, id).purchasedAt, null);
  assert.equal(after.refunds.filter(r => r.paymentId === p.paymentId && r.status === 'SUCCEEDED').length, 1);
  assert.equal((await c.api('/__policy-test', { body: {} })).providerRefundCreateCalls, calls);
});
