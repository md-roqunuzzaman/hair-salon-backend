import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

const regions = [
  { countryCode: 'HK', currency: 'HKD', timezone: 'Asia/Hong_Kong' },
  { countryCode: 'GB', currency: 'GBP', timezone: 'Europe/London' },
  { countryCode: 'US', currency: 'USD', timezone: 'America/New_York' },
  { countryCode: 'JP', currency: 'JPY', timezone: 'Asia/Tokyo' },
];
for (const settings of regions) test(`real Worker ${settings.currency}/${settings.timezone}: booking, payments and group snapshots`, async t => {
  const { api, fixture, state, ownerToken, managerToken, webhook } = await setup(t, 'true', 'false', undefined, settings);
  assert.deepEqual((await api('/api/v1/brand/international-settings', { roleToken: ownerToken })).data, settings);
  assert.equal((await api('/api/v1/brand')).data.currency, settings.currency);
  await api('/api/v1/brand/international-settings', { method: 'PATCH', body: { countryCode: settings.countryCode }, roleToken: managerToken, status: 403 });
  await t.test('unpaid Buy Later purchase snapshots currency and cannot block financial reports', async () => {
    const before = (await api('/api/v1/reports/payments', { roleToken: ownerToken })).data;
    const created = (await api('/api/v1/group-purchases', { status: 201, body: { packageId: fixture.packageId, branchId: fixture.branchId, quantity: 1 } })).data;
    const persisted = await state();
    assert.equal(persisted.purchases.find(p => p.id === created.purchaseId).currency, settings.currency);
    assert.equal(persisted.payments.some(p => p.groupPurchaseId === created.purchaseId), false);
    assert.equal(persisted.appointments.some(a => a.groupPurchaseId === created.purchaseId), false);
    assert.deepEqual((await api('/api/v1/reports/payments', { roleToken: ownerToken })).data, before);
  });
  for (const [index, method] of ['pay-now', 'deposit', 'reserve'].entries()) await t.test(method, async () => {
    const booking = (await api(`/api/v1/appointments/${method}`, { status: 201, body: {
      branchId: fixture.branchId, serviceId: fixture.serviceId, staffId: fixture.staffId, date: fixture.date, startTime: `${10 + index}:00`,
    } })).data;
    let row = (await state()).appointments.find(a => a.id === booking.appointmentId);
    assert.equal(row.currency, settings.currency);
    assert.equal(row.timezone, settings.timezone);
    assert.equal(row.date, `${fixture.date}T00:00:00.000Z`);
    if (method !== 'reserve') {
      const intent = (await api('/api/v1/payments/stripe/create-intent', { status: 201, body: { appointmentId: row.id } })).data;
      const event = await api('/__book-now-provider', { body: { paymentId: intent.paymentId } });
      assert.equal(event.data.object.currency, settings.currency.toLowerCase());
      assert.equal(event.data.object.amount, (method === 'deposit' ? 90 : 300) * (settings.currency === 'JPY' ? 1 : 100));
      await webhook(event);
      if (method === 'deposit') {
        row = (await state()).appointments.find(a => a.id === row.id);
        await api('/api/v1/appointments/verify-qr', { roleToken: ownerToken, body: { qrToken: row.qrToken, branchId: fixture.branchId } });
        const remaining = (await api(`/api/v1/payments/appointments/${row.id}/remaining-payment/stripe`, { body: {} })).data;
        const paid = await api('/__book-now-provider', { body: { paymentId: remaining.paymentId } });
        assert.equal(paid.data.object.amount, 210 * (settings.currency === 'JPY' ? 1 : 100));
        await webhook(paid);
      }
    } else {
      await api(`/api/v1/appointments/${row.id}/reschedule`, { body: { date: fixture.date, startTime: '14:00' } });
      await api(`/api/v1/appointments/${row.id}/cancel`, { body: { reason: 'Synthetic cancellation' } });
    }
  });
  for (const method of ['PAY_NOW', 'DEPOSIT', 'RESERVE_NOW']) await t.test(`group ${method}`, async () => {
    const time = { PAY_NOW: '16:00', DEPOSIT: '18:00', RESERVE_NOW: '20:00' }[method];
    const created = (await api('/api/v1/group-purchases', { status: 201, body: { ...fixture, quantity: 2, purchaseFlow: 'DIRECT_BOOK', bookingMethod: method, startTime: time } })).data;
    assert.equal(created.currency, settings.currency);
    assert.equal((await state()).purchases.find(p => p.id === created.purchaseId).currency, settings.currency);
    if (method !== 'RESERVE_NOW') {
      await api(`/api/v1/group-purchases/${created.purchaseId}/pay-with-wallet`, { body: { useBonus: false } });
      const row = (await state()).appointments.find(a => a.id === created.firstAppointment.appointmentId);
      assert.equal(row.currency, settings.currency);
      assert.equal(row.timezone, settings.timezone);
      if (method === 'DEPOSIT') {
        await api('/api/v1/appointments/verify-qr', { roleToken: ownerToken, body: { qrToken: row.qrToken, branchId: fixture.branchId } });
        const remaining = (await api(`/api/v1/payments/group-purchases/${created.purchaseId}/remaining-payment/stripe`, { body: {} })).data;
        const event = await api('/__book-now-provider', { body: { paymentId: remaining.paymentId } });
        assert.equal(event.data.object.currency, settings.currency.toLowerCase());
        assert.equal(event.data.object.amount, settings.currency === 'JPY' ? 140 : 14035);
        await webhook(event);
      }
    }
  });
  await t.test('topup preserves paid/bonus allocation in original wallet denomination', async () => {
    const promotion = (await api('/api/v1/promotions', { status: 201, roleToken: ownerToken, body: { name: 'Synthetic topup', minimumTopup: 100, bonusAmount: 10, status: 'ACTIVE', startAt: new Date(Date.now() - 86400000).toISOString(), endAt: new Date(Date.now() + 86400000).toISOString() } })).data;
    const before = (await state()).wallets[0];
    const topup = (await api('/api/v1/wallet/topups', { status: 201, body: { promotionId: promotion.id } })).data;
    const payment = (await state()).payments.find(p => p.walletTopupId === topup.topupId);
    assert.equal(payment.currency, settings.currency);
    const event = await api('/__book-now-provider', { body: { paymentId: payment.id } });
    assert.equal(event.data.object.amount, settings.currency === 'JPY' ? 100 : 10000);
    await webhook(event);
    const after = (await state()).wallets[0];
    assert.equal(Number(after.paidBalance) - Number(before.paidBalance), 100);
    assert.equal(Number(after.bonusBalance) - Number(before.bonusBalance), 10);
    const settled = await state(); await webhook(event); assert.deepEqual(await state(), settled);
  });
  await t.test('Buy Later Stripe purchase, voucher redemption and group refund preserve denomination', async () => {
    await api(`/api/v1/policy-management/branches/${fixture.branchId}/group-purchase-refunds`, { method: 'PUT', roleToken: ownerToken, body: { isEnabled: true, refundAllowed: true, allowPartiallyUsedRefund: true, allowExpiredRefund: false, requireNoActiveAppointments: true, refundTiers: [{ minimumMinutesAfterPurchase: 0, refundPercentage: 100 }], expectedVersion: 0 } });
    const buy = async () => {
      const p = (await api('/api/v1/group-purchases', { status: 201, body: { packageId: fixture.packageId, branchId: fixture.branchId, quantity: 1 } })).data;
      const intent = (await api('/api/v1/payments/group-purchase/create-intent', { status: 201, body: { purchaseId: p.purchaseId } })).data;
      const event = await api('/__book-now-provider', { body: { paymentId: intent.paymentId } });
      assert.equal(event.data.object.currency, settings.currency.toLowerCase());
      assert.equal(event.data.object.amount, settings.currency === 'JPY' ? 100 : 10025);
      await webhook(event); return p.purchaseId;
    };
    const used = await buy();
    await api(`/api/v1/group-purchases/${used}/book-appointment`, { status: 201, body: { branchId: fixture.branchId, date: fixture.date, startTime: '22:00' } });
    const redemption = (await state()).appointments.find(a => a.groupPurchaseId === used);
    assert.equal(redemption.currency, settings.currency); assert.equal(redemption.timezone, settings.timezone);
    const unused = await buy();
    const root = `/api/v1/cancellation-refund/group-purchases/${unused}`;
    const preview = (await api(`${root}/refund-preview`)).data;
    assert.equal(preview.refund.currency, settings.currency);
    const request = (await api(`${root}/refund-request`, { body: { reason: 'Synthetic unused voucher refund', idempotencyKey: `international-group-${settings.currency}`, previewToken: preview.previewToken } })).data;
    await api(`/api/v1/refund-requests/${request.id}/review`, { method: 'PATCH', roleToken: ownerToken, body: { decision: 'APPROVE' } });
    await api(`/api/v1/refund-requests/${request.id}/process`, { roleToken: ownerToken, body: {} });
    const provider = await api('/__policy-test', { body: {} });
    assert.equal(provider.providerRefunds.at(-1).currency, settings.currency.toLowerCase());
    assert.equal(provider.providerRefunds.at(-1).amount, settings.currency === 'JPY' ? 100 : 10025);
  });
  assert.equal((await api('/api/v1/wallet')).data.currency, settings.currency);
  await t.test('first wallet creation snapshots Brand denomination atomically', async () => {
    const email = `new-wallet-${settings.currency.toLowerCase()}@example.com`;
    await api('/__email-test-control', { body: { seedCustomer: email } });
    const token = (await api('/api/v1/auth/login', { body: { email, password: 'StrongPassword123!' } })).data.accessToken;
    const wallet = (await api('/api/v1/wallet', { roleToken: token })).data;
    assert.equal(wallet.currency, settings.currency);
    assert.equal(wallet.paidBalance, 0); assert.equal(wallet.bonusBalance, 0);
    assert.deepEqual((await api('/api/v1/wallet', { roleToken: token })).data, wallet);
  });
  await t.test('dashboard instant filters follow Brand-local midnight, including DST dates', async () => {
    const boundaries = {
      HKD: ['2026-03-29', '2026-03-28T16:15:00Z', '2026-03-28T15:59:00Z'],
      GBP: ['2026-03-29', '2026-03-29T00:15:00Z', '2026-03-28T23:59:00Z'],
      USD: ['2026-11-01', '2026-11-01T04:15:00Z', '2026-11-01T03:59:00Z'],
      JPY: ['2026-03-29', '2026-03-28T15:15:00Z', '2026-03-28T14:59:00Z'],
    };
    const [date, inside, outside] = boundaries[settings.currency];
    const payment = (await state()).payments.find(p => p.purpose === 'APPOINTMENT' && p.provider === 'STRIPE' && p.status === 'PAID');
    const dashboard = () => api(`/api/v1/dashboard?from=${date}&to=${date}`, { roleToken: ownerToken }).then(r => r.data);
    await api('/__policy-test', { body: { paymentCreatedAt: { id: payment.id, value: inside } } });
    const included = await dashboard();
    assert.equal(included.payments.currency, settings.currency);
    assert.equal(included.payments.stripeTotal, 300);
    await api('/__policy-test', { body: { paymentCreatedAt: { id: payment.id, value: outside } } });
    assert.equal((await dashboard()).payments.stripeTotal, 0);
    await api('/__policy-test', { body: { paymentCreatedAt: { id: payment.id, value: payment.createdAt } } });
  });
});

test('historical snapshots survive externally changed Brand settings; production settings guards and wallet/report isolation remain enforced', async t => {
  const { api, fixture, state, ownerToken, webhook } = await setup(t, 'true');
  const policy = { isEnabled: true, cancellationAllowed: true, refundAllowed: true, minimumCancellationMinutes: 0, nonRefundable: false, deductionTiers: [{ minimumMinutesBeforeAppointment: 0, calculationType: 'PERCENTAGE', deductionValue: 0 }], expectedVersion: 0 };
  await api(`/api/v1/policy-management/branches/${fixture.branchId}/service-cancellation`, { method: 'PUT', body: policy, roleToken: ownerToken });
  const book = async (path, startTime) => (await api(`/api/v1/appointments/${path}`, { status: 201, body: { branchId: fixture.branchId, serviceId: fixture.serviceId, date: fixture.date, startTime } })).data.appointmentId;
  const pay = async id => {
    const intent = (await api('/api/v1/payments/stripe/create-intent', { status: 201, body: { appointmentId: id } })).data;
    await webhook(await api('/__book-now-provider', { body: { paymentId: intent.paymentId } }));
    return intent.paymentId;
  };
  const old = await book('pay-now', '10:00'); await pay(old);
  const deposit = await book('deposit', '12:00'); await pay(deposit);
  const row = (await state()).appointments.find(a => a.id === deposit);
  await api('/api/v1/appointments/verify-qr', { body: { qrToken: row.qrToken, branchId: fixture.branchId }, roleToken: ownerToken });
  await api('/api/v1/brand/international-settings', { method: 'PATCH', roleToken: ownerToken, body: { currency: 'GBP' }, status: 409 });
  await api('/api/v1/brand/international-settings', { method: 'PATCH', roleToken: ownerToken, body: { timezone: 'America/New_York' }, status: 409 });
  // Deliberately bypass only in disposable fixtures to model an external/legacy settings change.
  await api('/__policy-test', { body: { internationalSettings: { currency: 'GBP', timezone: 'America/New_York' } } });
  const remaining = (await api(`/api/v1/payments/appointments/${deposit}/remaining-payment/stripe`, { body: {} })).data;
  const event = await api('/__book-now-provider', { body: { paymentId: remaining.paymentId } });
  assert.equal(event.data.object.currency, 'hkd'); assert.equal(event.data.object.amount, 21000); await webhook(event);
  const preview = (await api(`/api/v1/cancellation-refund/appointments/${old}/preview`)).data;
  assert.equal(preview.refund.currency, 'HKD'); assert.equal(preview.refund.refundAmount, 300);
  const cancelled = (await api(`/api/v1/cancellation-refund/appointments/${old}/cancel`, { body: { reason: 'Historical refund', idempotencyKey: 'historical-zone-currency', previewToken: preview.previewToken } })).data;
  await api(`/api/v1/refund-requests/${cancelled.refundRequestId}/review`, { method: 'PATCH', roleToken: ownerToken, body: { decision: 'APPROVE' } });
  await api(`/api/v1/refund-requests/${cancelled.refundRequestId}/process`, { roleToken: ownerToken, body: {} });
  const current = await book('pay-now', '14:00');
  const before = await state();
  await api(`/api/v1/appointments/${current}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
  assert.deepEqual(await state(), before);
  assert.equal(before.appointments.find(a => a.id === old).timezone, 'Asia/Hong_Kong');
  assert.equal(before.appointments.find(a => a.id === current).currency, 'GBP');
  assert.equal(before.wallets[0].currency, 'HKD');
  await api('/api/v1/reports/payments', { roleToken: ownerToken, status: 409 });
});
