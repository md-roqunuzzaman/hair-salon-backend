import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', REDIS_URL: 'redis://127.0.0.1:1', JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3), STRIPE_SECRET_KEY: 'sk_test_fixture' });
const { prisma } = await import('../src/app/lib/prisma.ts');
const { stripe } = await import('../src/app/lib/stripe.ts');
const { Prisma } = await import('../generated/prisma/client.ts');
const { getOrCreateLateGroupPurchaseRefund, ensureLateGroupPurchaseRefund, reconcileStripeRefund } = await import('../src/app/module/payment/late-group-refund.ts');
function stub(t, target, key, value) {
  const before = target[key]; target[key] = value; t.after(() => { target[key] = before; });
}
function fixture(t) {
  const payment = { id: 'payment', customerId: 'customer', groupPurchaseId: 'purchase', providerPaymentId: 'pi_test', provider: 'STRIPE', purpose: 'GROUP_PURCHASE', currency: 'HKD', amount: new Prisma.Decimal('100.25') };
  const row = { id: 'refund', paymentId: 'payment', payment, amount: payment.amount, reason: 'LATE_GROUP_PURCHASE_PAYMENT', idempotencyKey: 'late-group-purchase-refund-payment', status: 'PENDING', providerRefundId: null, refundClaimToken: null, refundClaimExpiresAt: null, refundAttemptedAt: null, createdAt: new Date(), refundedAt: null };
  const provider = { id: 're_test', payment_intent: 'pi_test', amount: 10025, currency: 'hkd', status: 'succeeded', metadata: { refundId: row.id, paymentId: payment.id, reason: row.reason } };
  const intent = { id: 'pi_test', amount: 10025, amount_received: 10025, currency: 'hkd', status: 'succeeded', metadata: { paymentId: payment.id, customerId: payment.customerId, groupPurchaseId: payment.groupPurchaseId, purpose: payment.purpose } };
  let creates = 0;
  let list = [];
  const matches = where => {
    for (const key of ['refundAttemptedAt', 'providerRefundId', 'refundClaimToken']) if (key in where && row[key] !== where[key]) return false;
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    if (where.status?.not === row.status) return false;
    if (where.refundClaimExpiresAt?.gt && !(row.refundClaimExpiresAt > where.refundClaimExpiresAt.gt)) return false;
    if (where.OR && !where.OR.some(branch => branch.refundClaimToken === null ? row.refundClaimToken === null : 'providerRefundId' in branch ? branch.providerRefundId === row.providerRefundId : row.refundClaimExpiresAt <= branch.refundClaimExpiresAt.lte)) return false;
    return true;
  };
  stub(t, prisma.payment, 'findUniqueOrThrow', async () => payment);
  stub(t, prisma.refund, 'findUniqueOrThrow', async () => ({ ...row }));
  stub(t, prisma.refund, 'findMany', async () => [{ ...row }]);
  stub(t, prisma.refund, 'count', async () => 0);
  stub(t, prisma.refund, 'update', async ({ data }) => Object.assign(row, data));
  stub(t, prisma.refund, 'updateMany', async ({ where, data }) => { if (!matches(where)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; });
  stub(t, stripe.paymentIntents, 'retrieve', async () => intent);
  stub(t, stripe.refunds, 'create', async (params, options) => { creates++; assert.equal(options.idempotencyKey, row.idempotencyKey); assert.ok(row.refundAttemptedAt); return provider; });
  stub(t, stripe.refunds, 'retrieve', async () => provider);
  stub(t, stripe.refunds, 'list', async () => ({ data: list, has_more: false }));
  return { row, payment, provider, intent, get creates() { return creates; }, set list(value) { list = value; } };
}
test('concurrent late refunds acquire one durable attempt; replay never creates again', async t => {
  const f = fixture(t);
  const results = await Promise.allSettled([ensureLateGroupPurchaseRefund('refund'), ensureLateGroupPurchaseRefund('refund')]);
  assert.equal(f.creates, 1);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal((await ensureLateGroupPurchaseRefund('refund')).status, 'SUCCEEDED');
  assert.equal(f.creates, 1);
  assert.equal(f.row.status, 'PENDING', 'Only atomic finalization may mark local success');
});
test('timeout after provider accepted is recovered by listing without a second create', async t => {
  const f = fixture(t);
  stub(t, stripe.refunds, 'create', async () => { f.list = [f.provider]; throw new Error('timeout'); });
  await assert.rejects(ensureLateGroupPurchaseRefund('refund'), /timeout/);
  assert.ok(f.row.refundAttemptedAt);
  assert.equal((await ensureLateGroupPurchaseRefund('refund')).providerRefundId, 're_test');
});
test('crash before local provider-ID persistence recovers the provider refund', async t => {
  const f = fixture(t);
  f.row.refundAttemptedAt = new Date(); f.list = [f.provider];
  assert.equal((await ensureLateGroupPurchaseRefund('refund')).status, 'SUCCEEDED');
  assert.equal(f.creates, 0);
});
test('unknown outcome with no listing match never reissues even after lease expiry', async t => {
  const f = fixture(t);
  f.row.refundAttemptedAt = new Date(0); f.row.refundClaimExpiresAt = new Date(0); f.row.refundClaimToken = 'old';
  assert.equal((await ensureLateGroupPurchaseRefund('refund')).requiresInvestigation, true);
  assert.equal(f.creates, 0);
});
test('expired unattempted claim may safely be acquired', async t => {
  const f = fixture(t); f.row.refundClaimToken = 'crashed'; f.row.refundClaimExpiresAt = new Date(0);
  assert.equal((await ensureLateGroupPurchaseRefund('refund')).status, 'SUCCEEDED'); assert.equal(f.creates, 1);
});
for (const status of ['pending', 'requires_action', 'failed', 'canceled']) {
  test(`provider ${status} is never finalized as successful`, async t => {
    const f = fixture(t); f.provider.status = status;
    const result = await ensureLateGroupPurchaseRefund('refund');
    assert.equal(result.status, ['failed', 'canceled'].includes(status) ? 'FAILED' : 'PENDING');
    assert.notEqual(f.row.status, 'SUCCEEDED');
    await ensureLateGroupPurchaseRefund('refund'); assert.equal(f.creates, 1);
  });
}
for (const [field, value] of [['amount', 10024], ['currency', 'usd'], ['payment_intent', 'pi_other'], ['payment_intent', null]]) {
  test(`provider mismatch ${field}=${value} blocks settlement`, async t => {
    const f = fixture(t); f.row.providerRefundId = 're_test'; f.provider[field] = value;
    await assert.rejects(reconcileStripeRefund('refund'), /mismatch/); assert.equal(f.row.status, 'PENDING');
  });
}
for (const field of ['customerId', 'groupPurchaseId', 'paymentId', 'purpose']) {
  test(`original PaymentIntent metadata ${field} must match before attempting`, async t => {
    const f = fixture(t); f.intent.metadata[field] = 'other';
    await assert.rejects(ensureLateGroupPurchaseRefund('refund'), /verification failed/);
    assert.equal(f.creates, 0); assert.equal(f.row.refundAttemptedAt, null);
  });
}
test('wrong PaymentIntent amount cannot initiate a refund', async t => {
  const f = fixture(t); f.intent.amount_received--;
  await assert.rejects(ensureLateGroupPurchaseRefund('refund'), /verification failed/); assert.equal(f.creates, 0);
});
test('wallet and salon payments cannot initiate Stripe refunds', async t => {
  const f = fixture(t);
  for (const provider of ['WALLET', 'SALON']) { f.payment.provider = provider; await assert.rejects(ensureLateGroupPurchaseRefund('refund'), /identity/); }
  assert.equal(f.creates, 0);
});
test('multiple matching provider refunds require investigation', async t => {
  const f = fixture(t); f.row.refundAttemptedAt = new Date(); f.list = [f.provider, { ...f.provider, id: 're_duplicate' }];
  await assert.rejects(reconcileStripeRefund('refund'), /Multiple/); assert.equal(f.creates, 0);
});
test('legacy local refund is marked possibly attempted before reuse', async t => {
  const f = fixture(t); f.row.idempotencyKey = null;
  const row = await getOrCreateLateGroupPurchaseRefund('payment', f.payment.amount);
  assert.ok(row.refundAttemptedAt); assert.equal(row.idempotencyKey, 'late-group-purchase-refund-payment');
});
test('duplicate local legacy records block automatic refunds', async t => {
  const f = fixture(t); stub(t, prisma.refund, 'findMany', async () => [f.row, { ...f.row, id: 'duplicate' }]);
  await assert.rejects(getOrCreateLateGroupPurchaseRefund('payment', f.payment.amount), /Multiple/); assert.equal(f.creates, 0);
});

const {walletRefundSplit}=await import('../src/app/module/wallet/wallet-payment-ledger.ts');
test('wallet cumulative rounding restores original paid/bonus exactly without cent drift',()=>{
 for(let total=1;total<=400;total++)for(const paid of new Set([0,Math.floor(total/3),Math.floor(total/2),total])){
  let restoredPaid=0,restoredBonus=0;
  for(let before=0;before<total;){const amount=Math.min(7,total-before),split=walletRefundSplit(total,paid,before,amount);restoredPaid+=split.paidCents;restoredBonus+=split.bonusCents;assert.equal(split.paidCents+split.bonusCents,amount);before+=amount;}
  assert.equal(restoredPaid,paid);assert.equal(restoredBonus,total-paid);
 }
 assert.throws(()=>walletRefundSplit(100,50,90,11),/INVALID/);
});
