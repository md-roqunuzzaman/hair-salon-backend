import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

test('My Orders retains the public contract, filters, localized names and canonical logical order numbers', async t => {
  const ctx = await setup(t);
  const seeded = await ctx.direct('/__my-orders-fixture', ctx.fixture);
  const all = (await ctx.api('/api/v1/payments/my?category=ALL&limit=100')).data;
  assert.equal(all.items.length, 9);
  assert.equal(all.pagination.total, 9);
  assert.ok(!all.items.some(row => row.id === seeded.otherPayment.id));
  const fields = ['id', 'orderId', 'orderNumber', 'category', 'itemName', 'services', 'amount', 'currency', 'paymentStatus',
    'provider', 'providerPaymentId', 'appointmentId', 'groupPurchaseId', 'walletTopupId', 'createdAt', 'purpose', 'label',
    'refundedAmount', 'canRefund', 'refundBlockedReason'];
  for (const row of all.items) {
    assert.deepEqual(Object.keys(row).sort(), [...fields].sort());
    assert.match(row.orderNumber, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(typeof row.amount, 'number');
    assert.equal(row.currency, 'HKD');
  }
  for (const category of ['GROUP_PURCHASE', 'REGULAR_PURCHASE', 'WALLET_TOPUP']) {
    const filtered = (await ctx.api('/api/v1/payments/my?category=' + category + '&limit=100')).data;
    assert.deepEqual(filtered.items.map(x => x.id).sort(), all.items.filter(x => x.category === category).map(x => x.id).sort());
    assert.equal(filtered.pagination.total, filtered.items.length);
  }
  for (const [lang, name, serviceName] of [['en', 'Voucher EN', 'Cut EN'], ['zh-CN', 'Voucher CN', 'Cut CN'], ['zh-HK', 'Voucher HK', 'Cut HK']]) {
    const response = await ctx.fetch('https://test/api/v1/payments/my?category=GROUP_PURCHASE', { headers: {
      authorization: 'Bearer ' + (await ctx.api('/api/v1/auth/login', { body: { email: 'book-now-customer@example.com', password: 'StrongPassword123!' } })).data.accessToken,
      'accept-language': lang,
    } });
    assert.equal(response.status, 200);
    const items = (await response.json()).data.items;
    for (const id of [seeded.initial.id, seeded.remaining.id, seeded.linkedOnly.id]) {
      const item = items.find(x => x.id === id);
      assert.equal(item.itemName, name);
      assert.equal(item.orderId, seeded.purchaseId);
      assert.equal(item.orderNumber, 'G2ABCD');
      assert.deepEqual(item.services.map(x => x.name).sort(), [serviceName, 'Fallback wash'].sort());
    }
  }
  for (const id of [seeded.deposit.id, seeded.regularRemaining.id]) {
    const item = all.items.find(x => x.id === id);
    assert.equal(item.orderNumber, 'A2BCDE');
    assert.equal(item.orderId, seeded.appointmentId);
  }
  for (const id of [seeded.firstTopup.id, seeded.secondTopup.id]) assert.equal(all.items.find(x => x.id === id).orderNumber, 'W2BCDE');
  assert.equal(all.items.find(x => x.id === seeded.unlinked.id).itemName, null);
  assert.deepEqual(all.items.find(x => x.id === seeded.unlinked.id).services, []);
  const paid = (await ctx.api('/api/v1/payments/my?status=PAID')).data;
  assert.equal(paid.pagination.total, 1);
  assert.equal(paid.items[0].id, seeded.secondTopup.id);
  const page1 = (await ctx.api('/api/v1/payments/my?page=1&limit=2')).data;
  const page2 = (await ctx.api('/api/v1/payments/my?page=2&limit=2')).data;
  assert.equal(page1.pagination.totalPages, 5);
  assert.ok(page2.items.every(x => !page1.items.some(y => x.id === y.id)));
  assert.equal(page2.pagination.hasPreviousPage, true);
  await ctx.api('/api/v1/payments/my?category=OTHER', { status: 400 });
  await ctx.api('/api/v1/payments/my', { roleToken: ctx.ownerToken, status: 403 });
  const unchanged = await ctx.direct('/__my-orders-fixture', { inspect: true });
  assert.equal(unchanged.payments.find(x => x.id === seeded.deposit.id).orderNumber, 'P2BCDE');
  assert.equal(unchanged.payments.find(x => x.id === seeded.regularRemaining.id).orderNumber, 'Q2BCDE');
  assert.equal(unchanged.payments.find(x => x.id === seeded.secondTopup.id).orderNumber, 'X2BCDE');

  const topups = await Promise.all(Array.from({ length: 6 }, () => ctx.api('/api/v1/wallet/topups', { body: { promotionId: seeded.promotionId }, status: 201 })));
  const finalState = await ctx.direct('/__my-orders-fixture', { inspect: true });
  const topupIds = new Set(topups.map(x => x.data.topupId));
  const newPayments = finalState.payments.filter(x => topupIds.has(x.walletTopupId));
  assert.equal(newPayments.length, 6);
  assert.equal(new Set(newPayments.map(x => x.orderNumber)).size, 6);
  const occupied = new Set(['G2ABCD', 'A2BCDE', 'P2BCDE', 'Q2BCDE', 'W2BCDE', 'X2BCDE', 'R2BCDE', 'U2BCDE', 'O2BCDE']);
  for (const payment of newPayments) {
    assert.match(payment.orderNumber, /^(?=.*[A-HJ-NP-Z])(?=.*[2-9])[A-HJ-NP-Z2-9]{6}$/);
    assert.ok(!occupied.has(payment.orderNumber));
    assert.equal(payment.amount, '123');
  }
});
