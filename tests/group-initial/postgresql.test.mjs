import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

test('group initial reconciliation executes against disposable PostgreSQL with provider calls forbidden in transactions', async t => {
  const bin = 'C:/Program Files/PostgreSQL/18/bin';
  await mkdir('dist', { recursive: true });
  const dir = await mkdtemp(path.resolve('dist/group-initial-pg-'));
  const data = path.join(dir, 'data'), password = randomBytes(24).toString('hex');
  const pwfile = path.join(dir, 'password'); await writeFile(pwfile, password, { mode: 0o600 });
  const command = (exe, args, silent = false) => {
    const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, ...(silent ? { stdio: 'ignore' } : {}) });
    assert.equal(r.status, 0, r.error?.message ?? r.stderr ?? 'Disposable PostgreSQL command failed'); return r.stdout;
  };
  command(path.join(bin, 'initdb.exe'), ['-D', data, '-U', 'group_initial_test', '--pwfile=' + pwfile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  command(path.join(bin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(dir, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], true);
  let client, db;
  t.after(async () => {
    await db?.$disconnect(); await client?.end();
    command(path.join(bin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], true);
  });
  const connection = { host: '127.0.0.1', port, user: 'group_initial_test', password, database: 'postgres' };
  client = new pg.Client(connection); await client.connect();
  const schema = command(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--config', 'cloudflare/node-client.config.ts', '--from-empty', '--to-schema', 'prisma/schema', '--script']);
  await client.query(schema);
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: `postgresql://group_initial_test:${password}@127.0.0.1:${port}/postgres`,
    REDIS_URL: 'redis://127.0.0.1:1', JWT_ACCESS_SECRET: 'synthetic-access-'.repeat(4), JWT_REFRESH_SECRET: 'synthetic-refresh-'.repeat(4),
    STRIPE_SECRET_KEY: 'sk_test_synthetic', ENABLE_BOOK_NOW_PURCHASE: 'true', TENCENT_MODERATION_ENABLED: 'false',
    OPENAI_API_KEY: 'synthetic', R2_ACCOUNT_ID: 'synthetic', R2_ACCESS_KEY_ID: 'synthetic', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET_NAME: 'synthetic',
  });
  ({ prisma: db } = await import('../../src/app/lib/prisma.ts'));
  const { stripe } = await import('../../src/app/lib/stripe.ts');
  const { groupPurchaseService } = await import('../../src/app/module/group-purchase/group-purchase.service.ts');
  const { groupPurchaseExpiryService } = await import('../../src/app/module/group-purchase/group-purchase-expiry.service.ts');
  const { paymentService } = await import('../../src/app/module/payment/payment.service.ts');
  const { walletService } = await import('../../src/app/module/wallet/wallet.service.ts');
  const { featureLicenseConfig } = await import('../../src/app/config/feature-license.config.ts');
  for (const name of ['GROUP_BUYING', 'WALLET']) Object.assign(featureLicenseConfig.features[name], { enabled: true, startsAt: '2020-01-01T00:00:00Z' });
  const transactionScope = new AsyncLocalStorage();
  const transact = db.$transaction.bind(db);
  db.$transaction = (operation, options) => typeof operation === 'function'
    ? transact(tx => transactionScope.run(true, () => operation(tx)), options) : transact(operation, options);
  const providerIO = () => assert.equal(Boolean(transactionScope.getStore()), false, 'Stripe operation inside a database transaction');
  const intents = new Map(), keys = new Map(), refunds = new Map();
  let cancellationCalls = 0, refundCalls = 0, captureOnCancel = false, refundTimeout = false;
  stripe.paymentIntents.create = async (params, options) => {
    providerIO(); if (keys.has(options.idempotencyKey)) return intents.get(keys.get(options.idempotencyKey));
    const p = { id: `pi_${randomUUID()}`, ...params, livemode: false, amount_received: 0, status: 'requires_payment_method', client_secret: 'synthetic-client-secret' };
    intents.set(p.id, p); keys.set(options.idempotencyKey, p.id); return p;
  };
  stripe.paymentIntents.retrieve = async id => { providerIO(); assert.ok(intents.has(id)); return intents.get(id); };
  stripe.paymentIntents.cancel = async id => {
    providerIO(); cancellationCalls++; const p = intents.get(id);
    if (captureOnCancel) { p.status = 'succeeded'; p.amount_received = p.amount; throw new Error('Synthetic capture race'); }
    assert.notEqual(p.status, 'succeeded'); assert.notEqual(p.status, 'processing'); p.status = 'canceled'; return p;
  };
  stripe.refunds.create = async (params, options) => {
    providerIO(); refundCalls++; if (refunds.has(options.idempotencyKey)) return refunds.get(options.idempotencyKey);
    const r = { id: `re_${randomUUID()}`, ...params, currency: intents.get(params.payment_intent).currency, status: 'succeeded' };
    refunds.set(options.idempotencyKey, r);
    if (refundTimeout) { refundTimeout = false; throw new Error('Synthetic timeout after refund acceptance'); }
    return r;
  };
  stripe.refunds.retrieve = async id => { providerIO(); return [...refunds.values()].find(r => r.id === id); };
  stripe.refunds.list = async params => { providerIO(); return { data: [...refunds.values()].filter(r => r.payment_intent === params.payment_intent), has_more: false }; };

  const customer = await db.user.create({ data: { name: 'Synthetic customer', email: 'group-initial@synthetic.invalid', passwordHash: 'synthetic', role: 'CUSTOMER' } });
  await db.brand.create({ data: { name: 'Synthetic brand' } });
  await db.wallet.create({ data: { customerId: customer.id, currency: 'HKD', paidBalance: 10000 } });
  const pkg = await db.package.create({ data: { name: 'Synthetic voucher', type: 'GROUP_PURCHASE_PACKAGE', regularPrice: 120, packagePrice: 100.25, durationMinutes: 30, capacity: 100 } });
  const create = async () => (await groupPurchaseService.createGroupPurchase(customer.id, { packageId: pkg.id, quantity: 1 })).purchaseId;
  const intent = id => paymentService.createGroupPurchaseStripeIntent(customer.id, { purchaseId: id });
  const local = id => db.payment.findUniqueOrThrow({ where: { id } });
  const purchase = id => db.groupPurchase.findUniqueOrThrow({ where: { id } });
  const expire = id => db.groupPurchase.update({ where: { id }, data: { reservationExpiresAt: new Date(0) } });
  const event = async (paymentId, type = 'payment_intent.succeeded') => {
    const p = intents.get((await local(paymentId)).providerPaymentId);
    p.status = type === 'payment_intent.succeeded' ? 'succeeded' : 'requires_payment_method';
    p.amount_received = p.status === 'succeeded' ? p.amount : 0;
    const e = { id: `evt_${randomUUID()}`, type, data: { object: p } }; return [e, p];
  };
  const settle = async paymentId => paymentService.handleGroupPurchaseStripeEvent(...await event(paymentId));

  await t.test('successful payment, one intent and idempotent replay', async () => {
    const id = await create(), [p, concurrent] = await Promise.all([intent(id), intent(id)]);
    assert.equal(concurrent.paymentId, p.paymentId); assert.equal((await intent(id)).paymentId, p.paymentId);
    const [e, provider] = await event(p.paymentId); await paymentService.handleGroupPurchaseStripeEvent(e, provider);
    assert.equal((await purchase(id)).paymentStatus, 'PAID');
    await paymentService.handleGroupPurchaseStripeEvent(e, provider); assert.equal((await purchase(id)).settledPaymentId, p.paymentId);
  });
  await t.test('expiry verifies cancellation and durable receipts stop repeated cleanup', async () => {
    const id = await create(), p = await intent(id); await expire(id);
    await groupPurchaseExpiryService.expirePendingGroupPurchases();
    assert.equal((await local(p.paymentId)).status, 'FAILED'); assert.equal((await purchase(id)).paymentStatus, 'FAILED');
    const count = cancellationCalls; await groupPurchaseExpiryService.expirePendingGroupPurchases(); assert.equal(cancellationCalls, count);
  });
  await t.test('processing remains pending, then late captured funds are refunded without activation', async () => {
    const id = await create(), p = await intent(id); intents.get((await local(p.paymentId)).providerPaymentId).status = 'processing';
    await expire(id); await groupPurchaseExpiryService.expirePendingGroupPurchases();
    assert.equal((await local(p.paymentId)).status, 'PENDING'); assert.equal((await purchase(id)).paymentStatus, 'FAILED');
    const calls = refundCalls; await settle(p.paymentId); assert.equal((await local(p.paymentId)).status, 'REFUNDED');
    assert.equal((await purchase(id)).purchasedAt, null); assert.equal(refundCalls, calls + 1);
    await settle(p.paymentId); assert.equal(refundCalls, calls + 1);
  });
  await t.test('a failed but chargeable attempt is cancelled before a new retry', async () => {
    const id = await create(), p = await intent(id);
    await paymentService.handleGroupPurchaseStripeEvent(...await event(p.paymentId, 'payment_intent.payment_failed'));
    const retry = await intent(id); assert.notEqual(retry.paymentId, p.paymentId);
    assert.equal(intents.get((await local(p.paymentId)).providerPaymentId).status, 'canceled');
    await expire(id); await groupPurchaseExpiryService.expirePendingGroupPurchases();
  });
  await t.test('Wallet switch cancels old Stripe attempt and preserves one winning settlement', async () => {
    const id = await create(), p = await intent(id);
    const paid = await walletService.payGroupPurchaseWithWallet(customer.id, id, { useBonus: false });
    assert.equal((await local(p.paymentId)).status, 'FAILED'); assert.equal((await purchase(id)).settledPaymentId, paid.paymentId);
    assert.equal(intents.get((await local(p.paymentId)).providerPaymentId).status, 'canceled');
  });
  await t.test('capture/cancellation race never debits Wallet after Stripe wins', async () => {
    const id = await create(); await intent(id); const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: customer.id } });
    captureOnCancel = true;
    await assert.rejects(walletService.payGroupPurchaseWithWallet(customer.id, id, { useBonus: false }), e => e.statusCode === 409);
    captureOnCancel = false; assert.equal((await purchase(id)).paymentStatus, 'PAID');
    assert.equal((await db.wallet.findUniqueOrThrow({ where: { customerId: customer.id } })).paidBalance.toString(), wallet.paidBalance.toString());
  });
  await t.test('real concurrent expiry and success converge on one refund and no inventory double release', async () => {
    const id = await create(), p = await intent(id); await expire(id); const [e, provider] = await event(p.paymentId);
    await Promise.allSettled([groupPurchaseExpiryService.expirePendingGroupPurchases(), paymentService.handleGroupPurchaseStripeEvent(e, provider)]);
    await paymentService.handleGroupPurchaseStripeEvent(e, provider); await groupPurchaseExpiryService.expirePendingGroupPurchases();
    assert.equal((await local(p.paymentId)).status, 'REFUNDED'); assert.equal((await purchase(id)).purchasedAt, null);
    assert.equal(await db.refund.count({ where: { paymentId: p.paymentId, status: 'SUCCEEDED' } }), 1);
    const item = await db.package.findUniqueOrThrow({ where: { id: pkg.id } }); assert.equal(item.reservedQuantity, 0);
  });
  await t.test('missed success webhook and refund timeout recover by provider lookup on the next cleanup', async () => {
    const id = await create(), p = await intent(id); await expire(id); await event(p.paymentId);
    refundTimeout = true;
    await assert.rejects(groupPurchaseExpiryService.expirePendingGroupPurchases(), e => e.statusCode === 503);
    assert.equal((await local(p.paymentId)).status, 'PAID'); const calls = refundCalls;
    await groupPurchaseExpiryService.expirePendingGroupPurchases();
    assert.equal((await local(p.paymentId)).status, 'REFUNDED'); assert.equal(refundCalls, calls);
    assert.equal((await purchase(id)).purchasedAt, null);
  });
});
