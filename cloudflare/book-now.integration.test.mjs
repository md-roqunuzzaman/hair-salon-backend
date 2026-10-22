import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHmac } from 'node:crypto';
const require = createRequire(path.resolve('node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
async function setup(t, flag) {
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), modules: true, scriptPath: 'cloudflare/.build/integration.mjs', compatibilityDate: '2025-10-11', compatibilityFlags: ['nodejs_compat', 'enable_nodejs_http_server_modules'], modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }], durableObjects: { SALON_DB: { className: 'SalonTestDatabase', useSQLite: true } }, bindings: {
    NODE_ENV: 'production', CORS_ORIGIN: 'https://frontend.example.com', BCRYPT_SALT_ROUNDS: '10', JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3), STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_test', OPENAI_API_KEY: 'test-key', R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'test', EMAIL_SENDER: 'test@example.com', BOOTSTRAP_TOKEN: 'test-bootstrap-token-'.repeat(3), BRAND_OWNER_NAME: 'Owner', BRAND_OWNER_EMAIL: 'owner@example.com', BRAND_OWNER_PASSWORD: 'OwnerPassword123!', ...(flag !== undefined && { ENABLE_BOOK_NOW_PURCHASE: flag }),
  } });
  t.after(() => mf.dispose());
  let token;
  const api = async (url, { body, method = body ? 'POST' : 'GET', status = 200, roleToken = token } = {}) => {
    const response = await mf.dispatchFetch(`https://test${url}`, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(roleToken && { authorization: `Bearer ${roleToken}` }) }, ...(body && { body: JSON.stringify(body) }) });
    const text = await response.text(); assert.equal(response.status, status, `${method} ${url}: ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const bootstrap = await mf.dispatchFetch('https://test/__setup', { method: 'POST', headers: { authorization: `Bearer ${'test-bootstrap-token-'.repeat(3)}` } });
  assert.equal(bootstrap.status, 200, await bootstrap.text());
  const credentials = { email: 'book-now-customer@example.com', password: 'StrongPassword123!' };
  const registered = await api('/api/v1/auth/register', { body: { ...credentials, name: 'Book Now Customer' }, status: 201 });
  token = (await api('/api/v1/auth/login', { body: credentials })).data.accessToken;
  const ownerToken = (await api('/api/v1/auth/login', { body: { email: 'owner@example.com', password: 'OwnerPassword123!' } })).data.accessToken;
  const fixture = await api('/__book-now-fixture', { body: { customerId: registered.data.id } });
  const state = () => api('/__book-now-state');
  const webhook = async event => {
    const body = JSON.stringify(event); const time = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', 'whsec_test').update(`${time}.${body}`).digest('hex');
    const response = await mf.dispatchFetch('https://test/api/v1/payments/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${time},v1=${signature}` }, body });
    assert.equal(response.status, 200, await response.text());
  };
  const cron = async () => { const namespace = await mf.getDurableObjectNamespace('SALON_DB'); const response = await namespace.get(namespace.idFromName('salon-v1')).fetch('https://internal/__internal/cron'); assert.equal(response.status, 200, await response.text()); };
  return { api, ownerToken, fixture, state, webhook, cron };
}

for (const flag of [undefined, 'false']) test(`Book Now public creation is disabled for flag=${flag ?? 'missing'}`, async t => {
  const { api, fixture, state } = await setup(t, flag);
  const before = await state();
  const result = await api('/api/v1/group-purchases', { body: { ...fixture, quantity: 2, purchaseFlow: 'BUY_NOW_BOOK_NOW', bookingMethod: 'PAY_NOW', startTime: '10:00' }, status: 422 });
  assert.match(result.message, /not enabled/);
  assert.deepEqual(await state(), before);
  await api('/api/v1/group-purchases', { body: { packageId: fixture.packageId, quantity: 1 }, status: 201 });
});

test('enabled public Book Now creation, Stripe, wallet, QR, salon and expiry end to end', async t => {
  const { api, ownerToken, fixture, state, webhook, cron } = await setup(t, 'true');
  const root = '/api/v1/group-purchases';
  await t.test('validation and amount tampering cannot bypass rules', async () => {
    await api(root, { body: { packageId: fixture.packageId, quantity: 1, purchaseFlow: 'BUY_NOW_BOOK_NOW' }, status: 400 });
    await api(root, { body: { ...fixture, quantity: 0, purchaseFlow: 'BUY_NOW_BOOK_NOW', bookingMethod: 'PAY_NOW', startTime: '08:00' }, status: 400 });
  });
  let index = 0;
  for (const [method, provider] of [['PAY_NOW', 'STRIPE'], ['DEPOSIT', 'STRIPE'], ['PAY_NOW', 'WALLET'], ['DEPOSIT', 'WALLET'], ['RESERVE_NOW', 'SALON']]) {
    const startTime = `${String(8 + index++ * 2).padStart(2, '0')}:00`;
    await t.test(`${method} via ${provider}: public purchase to full payment`, async () => {
      const before = await state();
      const created = (await api(root, { body: { ...fixture, quantity: 2, purchaseFlow: 'BUY_NOW_BOOK_NOW', bookingMethod: method, startTime, amount: 1, depositAmount: 1 }, status: 201 })).data;
      const id = created.purchaseId; const appointmentId = created.firstAppointment.appointmentId;
      assert.equal(created.amount, 200.5);
      assert.equal(created.depositAmount, method === 'DEPOSIT' ? 60.15 : null);
      assert.equal(created.paymentStatus, method === 'RESERVE_NOW' ? 'UNPAID' : 'PENDING');
      assert.equal(created.reservationExpiresAt === null, method === 'RESERVE_NOW');
      await api(`/api/v1/appointments/${appointmentId}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
      await api('/api/v1/payments/stripe/create-intent', { body: { appointmentId }, status: 409 });
      await api(`/api/v1/appointments/${appointmentId}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken, status: 409 });
      await api(`${root}/${id}/book-appointment`, { body: { branchId: fixture.branchId, date: fixture.date, startTime: '21:00' }, status: 409 });
      if (provider === 'STRIPE') {
        const concurrentIntents = await Promise.all([1, 2].map(() => api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 201 })));
        assert.equal(concurrentIntents[0].data.paymentId, concurrentIntents[1].data.paymentId);
        assert.equal(concurrentIntents[0].data.clientSecret, concurrentIntents[1].data.clientSecret);
        const intent = concurrentIntents[0].data;
        assert.equal(intent.amount, method === 'DEPOSIT' ? 60.15 : 200.5);
        const repeat = (await api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 201 })).data;
        assert.equal(repeat.paymentId, intent.paymentId); assert.equal(repeat.clientSecret, intent.clientSecret);
        await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
        const event = await api('/__book-now-provider', { body: { paymentId: intent.paymentId } });
        await webhook(event); const paidState = await state(); await webhook(event);
        await webhook({ ...event, id: `${event.id}_replay` });
        const replayState = await state();
        assert.deepEqual(replayState.wallets, paidState.wallets);
        assert.equal(replayState.notifications.length, paidState.notifications.length);
      } else if (provider === 'WALLET') {
        const paid = (await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true } })).data;
        assert.equal(paid.amountPaid, method === 'DEPOSIT' ? 60.15 : 200.5);
        const after = await state();
        assert.equal(Math.round(Number(before.wallets[0].paidBalance) * 100) + Math.round(Number(before.wallets[0].bonusBalance) * 100) - Math.round(Number(after.wallets[0].paidBalance) * 100) - Math.round(Number(after.wallets[0].bonusBalance) * 100), Math.round(paid.amountPaid * 100));
        await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
        assert.deepEqual((await state()).wallets, after.wallets);
      } else {
        await api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 422 });
        await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true }, status: 422 });
      }
      let current = await state(); let purchase = current.purchases.find(row => row.id === id); let appointment = current.appointments.find(row => row.id === appointmentId);
      assert.equal(appointment.appointmentStatus, method === 'PAY_NOW' ? 'CONFIRMED' : 'RESERVED');
      assert.equal(appointment.paymentStatus, method === 'PAY_NOW' ? 'PAID' : method === 'DEPOSIT' ? 'PARTIALLY_PAID' : 'UNPAID');
      assert.equal(!!appointment.qrToken, method !== 'PAY_NOW');
      await api(`/api/v1/appointments/${appointmentId}/cancel`, { body: { reason: 'Test cancellation' }, status: 409 });
      if (method !== 'PAY_NOW') {
        await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken, status: 409 });
        await api(`/api/v1/appointments/${appointmentId}/qr`);
        await api('/api/v1/appointments/verify-qr', { body: { qrToken: appointment.qrToken, branchId: fixture.branchId }, roleToken: ownerToken });
        await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, status: 403 });
        const remaining = await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken });
        assert.equal(remaining.success, true);
        current = await state(); purchase = current.purchases.find(row => row.id === id);
        const salon = current.payments.find(row => row.groupPurchaseId === id && row.provider === 'SALON');
        assert.equal(Number(salon.amount), method === 'DEPOSIT' ? 140.35 : 200.5);
        await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken, status: 409 });
      }
      assert.equal(purchase.paymentStatus, 'PAID');
      const inventory = (await state()).packages.find(row => row.id === fixture.packageId);
      assert.equal(inventory.soldQuantity, index * 2); assert.equal(inventory.reservedQuantity, 0);
    });
  }
  await t.test('initial entitlement counts and redemption cannot exceed quantity', async () => {
    const purchase = (await state()).purchases[0];
    await api(`${root}/${purchase.id}/book-appointment`, { body: { branchId: fixture.branchId, date: fixture.date, startTime: '19:00' }, status: 201 });
    await api(`${root}/${purchase.id}/book-appointment`, { body: { branchId: fixture.branchId, date: fixture.date, startTime: '20:00' }, status: 409 });
  });
  await t.test('public pending purchase expires once and late signed success refunds once', async () => {
    const created = (await api(root, { body: { ...fixture, quantity: 2, purchaseFlow: 'BUY_NOW_BOOK_NOW', bookingMethod: 'PAY_NOW', startTime: '18:00' }, status: 201 })).data;
    const intent = (await api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: created.purchaseId }, status: 201 })).data;
    await api('/__book-now-expire', { body: { purchaseId: created.purchaseId } });
    await cron(); await cron();
    let current = await state();
    assert.equal(current.purchases.find(row => row.id === created.purchaseId).paymentStatus, 'FAILED');
    assert.equal(current.appointments.find(row => row.id === created.firstAppointment.appointmentId).appointmentStatus, 'EXPIRED');
    const inventory = current.packages[0];
    const event = await api('/__book-now-provider', { body: { paymentId: intent.paymentId } });
    await webhook(event); await webhook({ ...event, id: `${event.id}_retry` });
    current = await state();
    assert.equal(current.payments.find(row => row.id === intent.paymentId).status, 'REFUNDED');
    assert.equal(current.refunds.filter(row => row.paymentId === intent.paymentId).length, 1);
    assert.deepEqual(current.packages[0], inventory);
  });
});
