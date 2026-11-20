import assert from 'node:assert/strict';
import { createAdminOrderService } from '../../src/app/module/admin-order/admin-order.service.ts';
import { orderQuery, orderParams } from '../../src/app/module/admin-order/admin-order.validation.ts';
import { orderSQL } from '../../src/app/module/admin-order/admin-order.query.ts';

// Synthetic data only, in the disposable database supplied by each test runner.
export async function fixture(db) {
  const user = (name, role) => db.user.create({ data: { name, role, email: name + '@admin-order.invalid', passwordHash: 'synthetic-not-a-login-hash', emailVerified: true, mustChangePassword: false } });
  const owner = await user('owner', 'BRAND_OWNER');
  const otherOwner = await user('foreign-owner', 'BRAND_OWNER');
  const manager = await user('manager', 'BRANCH_MANAGER');
  const stranger = await user('stranger', 'BRANCH_MANAGER');
  const customer = await user('customer', 'CUSTOMER');
  const brand = await db.brand.create({ data: { name: 'Owned', ownerId: owner.id } });
  const foreignBrand = await db.brand.create({ data: { name: 'Foreign', ownerId: otherOwner.id } });
  const branch = await db.branch.create({ data: { name: 'Authorized', address: 'Synthetic', brandId: brand.id } });
  const secondBranch = await db.branch.create({ data: { name: 'Owner second', address: 'Synthetic', brandId: brand.id } });
  const foreignBranch = await db.branch.create({ data: { name: 'Foreign', address: 'Synthetic', brandId: foreignBrand.id } });
  await db.branchManagerBranch.create({ data: { userId: manager.id, branchId: branch.id } });
  const pkg = await db.package.create({ data: { name: 'Current voucher name', type: 'GROUP_PURCHASE_PACKAGE', regularPrice: 200, packagePrice: 123.45, durationMinutes: 30,
    branches: { create: { branchId: foreignBranch.id } } } });
  let n = 0;
  const appointment = async (data = {}) => db.appointment.create({ data: {
    customerId: customer.id, branchId: branch.id, staffId: null, orderNumber: 'A' + String(++n).padStart(5, '0'),
    bookingMethod: 'PAY_NOW', appointmentStatus: 'CONFIRMED', paymentStatus: 'PAID',
    date: new Date('2026-11-25'), startTime: '10:00', endTime: '10:30', durationMinutes: 30,
    price: 123.45, currency: 'HKD', itemName: 'Historical haircut', qrToken: 'private-qr-' + n,
    createdAt: new Date(Date.UTC(2026, 10, n)), updatedAt: new Date('2026-11-20'), ...data,
  } });
  const statuses = ['PENDING_PAYMENT', 'RESERVED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'];
  const paymentStatuses = ['UNPAID', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED'];
  const appointments = [];
  for (let i = 0; i < statuses.length; i++) appointments.push(await appointment({
    appointmentStatus: statuses[i], paymentStatus: paymentStatuses[i], bookingMethod: ['PAY_NOW', 'DEPOSIT', 'RESERVE_NOW'][i % 3],
  }));
  const second = await appointment({ branchId: secondBranch.id });
  const foreign = await appointment({ branchId: foreignBranch.id });
  const snapshot = (branchId, module = 'GROUP_REFUND') => ({ engineVersion: 1, module, branchId, version: 1, config: { isEnabled: true } });
  const purchase = data => db.groupPurchase.create({ data: {
    customerId: customer.id, packageId: pkg.id, currency: 'HKD', quantity: 5, unitPrice: 123.45, amount: 617.25,
    bookingMethod: 'DEPOSIT', paymentStatus: 'PARTIALLY_PAID', createdAt: new Date('2026-11-12'),
    purchasedAt: new Date('2026-11-12'), validDaysSnapshot: 10, ...data,
  } });
  const group = await purchase({ purchaseBranchId: branch.id, orderNumber: 'G00001', depositAmount: 100, remainingAmount: 517.25 });
  const legacy = await purchase({ purchaseBranchId: branch.id, purchaseFlow: 'DIRECT_BOOK', paymentStatus: 'REFUNDED', orderNumber: 'G00002' });
  const branchless = await purchase({ refundPolicySnapshot: snapshot(branch.id) });
  const cancellationOnly = await purchase({ cancellationPolicySnapshot: snapshot(branch.id, 'GROUP_CANCEL') });
  const sameBrand = await purchase({ refundPolicySnapshot: snapshot(branch.id), cancellationPolicySnapshot: snapshot(secondBranch.id, 'GROUP_CANCEL') });
  const unknown = await purchase({});
  const conflict = await purchase({ refundPolicySnapshot: snapshot(branch.id), cancellationPolicySnapshot: snapshot(foreignBranch.id, 'GROUP_CANCEL') });
  const foreignGroup = await purchase({ refundPolicySnapshot: snapshot(foreignBranch.id) });
  const invalid = await purchase({ refundPolicySnapshot: { engineVersion: 0, module: 'GROUP_REFUND', branchId: branch.id } });
  const invalidVersionType = await purchase({ refundPolicySnapshot: { engineVersion: '1', module: 'GROUP_REFUND', branchId: branch.id } });
  const redemption = await appointment({ groupPurchaseId: group.id, packageId: pkg.id, bookingMethod: 'GROUP_PURCHASE', price: 0 });
  const foreignRedemption = await appointment({ groupPurchaseId: group.id, branchId: foreignBranch.id, packageId: pkg.id, price: 0 });
  // A real link through a redemption is not proof of the historical sale's brand.
  await appointment({ groupPurchaseId: unknown.id, price: 0 });
  const payment = data => db.payment.create({ data: { customerId: customer.id, currency: 'HKD', amount: 10.25, status: 'PAID', purpose: 'APPOINTMENT', ...data } });
  const stripe = await payment({ appointmentId: appointments[0].id, provider: 'STRIPE', providerPaymentId: 'private-provider-id' });
  await payment({ appointmentId: appointments[0].id, provider: 'WALLET', purpose: 'APPOINTMENT_REMAINING', amount: 13.45 });
  for (const method of ['CASH', 'CARD', 'FPS', 'WECHAT_PAY', 'ALIPAY', 'OTHER']) await payment({
    appointmentId: appointments[1].id, provider: 'SALON', salonPaymentMethod: method,
    purpose: method === 'CASH' ? 'APPOINTMENT_DEPOSIT' : 'APPOINTMENT_REMAINING',
  });
  const groupInitial = await payment({ groupPurchaseId: group.id, purpose: 'GROUP_PURCHASE', amount: 100 });
  const directRemaining = await payment({ groupPurchaseId: group.id, purpose: 'GROUP_PURCHASE', amount: 517.25, provider: 'SALON' });
  const groupRemaining = await payment({ appointmentId: redemption.id, purpose: 'APPOINTMENT_REMAINING', amount: 517.25, provider: 'WALLET' });
  const foreignPayment = await payment({ appointmentId: foreignRedemption.id, purpose: 'APPOINTMENT_REMAINING', provider: 'SALON', salonPaymentMethod: 'OTHER' });
  await db.groupPurchase.update({ where: { id: group.id }, data: { settledPaymentId: groupInitial.id } });
  const refund = await db.refund.create({ data: { paymentId: stripe.id, amount: 3.25, reason: 'Synthetic', status: 'SUCCEEDED', idempotencyKey: 'private-refund-key', refundClaimToken: 'private-claim' } });
  await db.refund.create({ data: { paymentId: stripe.id, amount: 2, reason: 'Pending', status: 'PENDING' } });
  const request = await db.refundRequest.create({ data: { customerId: customer.id, paymentId: stripe.id, amount: 3.25, reason: 'Synthetic', status: 'COMPLETED', refundId: refund.id, idempotencyKey: 'private-request-key' } });
  await db.refundAllocation.create({ data: { refundRequestId: request.id, paymentId: stripe.id, refundId: refund.id, amount: 3.25, provider: 'STRIPE', status: 'SUCCEEDED', idempotencyKey: 'private-allocation-key' } });
  // Conflicting financial links must never match a method filter or appear in the view.
  await payment({ appointmentId: appointments[2].id, groupPurchaseId: foreignGroup.id, provider: 'WALLET' });
  const wallet = await db.wallet.create({ data: { customerId: customer.id } });
  const topup = await db.walletTopup.create({ data: { walletId: wallet.id, amount: 50 } });
  await payment({ walletTopupId: topup.id, purpose: 'WALLET_TOP_UP', amount: 50 });
  return { owner, manager, stranger, customer, branch, secondBranch, foreignBranch, appointments, second, foreign,
    group, legacy, branchless, cancellationOnly, sameBrand, unknown, conflict, foreignGroup, invalid, invalidVersionType, redemption, foreignRedemption, stripe, groupInitial, groupRemaining, directRemaining, foreignPayment };
}

export async function checks(db, dialect, f) {
  const service = createAdminOrderService(db, dialect);
  const state = async () => JSON.stringify(await Promise.all(['appointment', 'groupPurchase', 'payment', 'refund', 'refundRequest', 'refundAllocation', 'wallet', 'walletTransaction', 'walletTopup']
    .map(model => db[model].findMany({ orderBy: { id: 'asc' } }))));
  const before = await state();
  const list = (query = {}, actor = f.owner) => service.list({ userId: actor.id, role: actor.role }, orderQuery.parse(query));
  const detail = (type, id, actor = f.owner) => service.detail({ userId: actor.id, role: actor.role }, orderQuery.parse({}), type, id);
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (e) { results.push({ name, pass: false, error: e.stack }); } };
  await check('all seven appointment statuses and three booking methods; no status exclusion', async () => {
    const r = await list({ orderType: 'APPOINTMENT', limit: 100 });
    assert.equal(r.pagination.total, 8);
    assert.equal(new Set(r.items.map(x => x.appointmentStatus)).size, 7);
    assert.equal(new Set(r.items.map(x => x.bookingMethod)).size, 3);
  });
  await check('all group flows, branchless snapshot ownership, no redemption double counting', async () => {
    const r = await list({ limit: 100 }); assert.equal(r.pagination.total, 13); assert.equal(r.items.length, 13);
    assert.ok(r.items.some(x => x.id === f.legacy.id && x.purchaseFlow === 'DIRECT_BOOK'));
    assert.equal(r.items.some(x => x.id === f.redemption.id), false);
    assert.equal((await detail('GROUP_PURCHASE', f.branchless.id)).branch, null);
    assert.equal((await detail('GROUP_PURCHASE', f.cancellationOnly.id)).branch, null);
    assert.equal((await detail('GROUP_PURCHASE', f.sameBrand.id)).branch, null);
  });
  await check('unknown, conflicting, malformed and foreign snapshot ownership fails closed', async () => {
    for (const g of [f.unknown, f.conflict, f.foreignGroup, f.invalid, f.invalidVersionType]) await assert.rejects(detail('GROUP_PURCHASE', g.id), e => e.statusCode === 404);
  });
  await check('manager ACL before pagination, cannot see branchless or foreign orders', async () => {
    const r = await list({ limit: 100 }, f.manager); assert.equal(r.pagination.total, 9);
    for (const g of [f.branchless, f.cancellationOnly, f.foreignGroup]) await assert.rejects(detail('GROUP_PURCHASE', g.id, f.manager), e => e.statusCode === 404);
    await assert.rejects(detail('APPOINTMENT', f.second.id, f.manager), e => e.statusCode === 404);
    assert.equal((await list({}, f.stranger)).pagination.total, 0);
  });
  await check('CUSTOMER, STAFF and SUPER_ADMIN forbidden', async () => {
    for (const role of ['CUSTOMER', 'STAFF', 'SUPER_ADMIN']) await assert.rejects(list({}, { id: f.owner.id, role }), e => e.statusCode === 403);
  });
  await check('branch filter never treats snapshot branch as historical sale branch', async () => {
    assert.equal((await list({ branchId: f.branch.id })).pagination.total, 9);
    assert.equal((await list({ branchId: f.foreignBranch.id })).pagination.total, 0);
  });
  await check('payment methods, multiple payments and deposit/remaining purposes', async () => {
    const r = await detail('APPOINTMENT', f.appointments[1].id);
    assert.deepEqual(r.payments.map(x => x.method).sort(), ['ALIPAY', 'CARD', 'CASH', 'FPS', 'OTHER', 'WECHAT_PAY']);
    assert.ok(r.payments.some(x => x.purpose === 'APPOINTMENT_DEPOSIT'));
    assert.ok(r.payments.some(x => x.purpose === 'APPOINTMENT_REMAINING'));
    const first = await detail('APPOINTMENT', f.appointments[0].id);
    assert.deepEqual(first.payments.map(x => x.provider).sort(), ['STRIPE', 'WALLET']);
    assert.equal(first.paymentStatus, 'UNPAID'); // Stored order status is never inferred from child rows.
  });
  await check('provider/method filter uses same payment record, rejects contradictory parents', async () => {
    assert.equal((await list({ paymentProvider: 'SALON', salonPaymentMethod: 'FPS' })).pagination.total, 1);
    assert.equal((await list({ paymentProvider: 'STRIPE', salonPaymentMethod: 'FPS' })).pagination.total, 0);
    assert.equal((await list({ salonPaymentMethod: 'OTHER' })).pagination.total, 1);
    const r = await list({ paymentProvider: 'WALLET', limit: 100 });
    assert.deepEqual(r.items.map(x => x.id).sort(), [f.appointments[0].id, f.group.id].sort());
    assert.equal((await detail('APPOINTMENT', f.appointments[2].id)).payments.length, 0);
  });
  await check('group initial, settled and redemption payments each appear once', async () => {
    const r = await detail('GROUP_PURCHASE', f.group.id);
    assert.deepEqual(r.payments.map(p => p.id).sort(), [f.groupInitial.id, f.groupRemaining.id, f.directRemaining.id].sort());
    assert.equal(r.payments.find(p => p.id === f.groupInitial.id).stage, 'DEPOSIT');
    assert.equal(r.payments.find(p => p.id === f.directRemaining.id).stage, 'REMAINING');
    assert.equal(r.payments.some(p => p.id === f.foreignPayment.id), false);
    assert.equal(r.relatedAppointments.length, 1); assert.equal(r.relatedAppointments[0].id, f.redemption.id);
    assert.equal(r.depositAmount, '100.00'); assert.equal(r.remainingAmount, '517.25');
    assert.equal(new Date(r.expiresAt).toISOString(), '2026-11-22T00:00:00.000Z');
  });
  await check('refund/request/allocation reported without double counting', async () => {
    const r = await detail('APPOINTMENT', f.appointments[0].id);
    assert.deepEqual(r.refundedAmounts, [{ currency: 'HKD', amount: '3.25' }]);
    const p = r.payments.find(p => p.id === f.stripe.id);
    assert.equal(p.refunds.length, 2); assert.equal(p.refundRequests[0].allocations.length, 1);
  });
  await check('accurate global sort, page boundaries and stable ties', async () => {
    for (const sortBy of ['createdAt', 'updatedAt', 'amount', 'orderNumber']) for (const sortOrder of ['asc', 'desc']) {
      const all = await list({ limit: 100, sortBy, sortOrder });
      const pages = [];
      for (let page = 1; page <= 7; page++) { const r = await list({ page, limit: 2, sortBy, sortOrder }); assert.equal(r.pagination.total, 13); pages.push(...r.items); }
      assert.deepEqual(pages.map(x => x.id), all.items.map(x => x.id));
      if (sortBy === 'amount') { const nums = all.items.map(x => Number(x.amount)); assert.deepEqual(nums, [...nums].sort((a, b) => sortOrder === 'asc' ? a - b : b - a)); }
    }
    assert.deepEqual((await list({ page: 20 })).items, []);
  });
  await check('createdAt date range inclusive start and exclusive end', async () => {
    const r = await list({ startDate: '2026-11-02T00:00:00Z', endDate: '2026-11-04T00:00:00Z', limit: 100 });
    assert.deepEqual(r.items.map(x => x.id).sort(), [f.appointments[1].id, f.appointments[2].id].sort());
  });
  await check('customer, booking method and status filters', async () => {
    assert.equal((await list({ customerId: f.customer.id })).pagination.total, 13);
    assert.equal((await list({ bookingMethod: 'RESERVE_NOW' })).pagination.total, 2);
    assert.equal((await list({ appointmentStatus: 'EXPIRED' })).pagination.total, 1);
    assert.equal((await list({ paymentStatus: 'REFUNDED' })).pagination.total, 2);
  });
  await check('search values are parameterized and LIKE wildcards escaped', async () => {
    assert.equal((await list({ search: 'historical HAIRCUT' })).pagination.total, 8);
    for (const search of ["' OR 1=1 --", '%', '_', '!']) assert.equal((await list({ search })).pagination.total, 0);
    const sql = orderSQL({ userId: f.owner.id, role: 'BRAND_OWNER' }, orderQuery.parse({ search: "' OR 1=1 --" }), dialect);
    assert.ok(!sql.page.sql.includes("' OR 1=1 --")); assert.ok(sql.page.values.some(x => String(x).includes("' or 1=1 --")));
    assert.match(sql.page.text, /\$1/);
  });
  await check('no secrets, QR tokens, raw policy snapshots or invented order numbers', async () => {
    const text = JSON.stringify((await list({ limit: 100 })).items);
    for (const key of ['passwordHash', 'qrToken', 'providerPaymentId', 'idempotencyKey', 'refundClaimToken', 'refundPolicySnapshot']) assert.equal(text.includes('"' + key + '"'), false, key);
    assert.equal((await detail('GROUP_PURCHASE', f.branchless.id)).orderNumber, null);
    assert.equal((await detail('APPOINTMENT', f.appointments[0].id)).staff, null);
  });
  await check('query bounds and enums reject invalid input', () => {
    for (const query of [{ page: 0 }, { limit: 101 }, { orderType: 'WALLET_TOPUP' }, { sortBy: 'id;DELETE' }, { startDate: 'yesterday' }, { surprise: 'x' }, { startDate: '2026-11-02T00:00:00Z', endDate: '2026-11-01T00:00:00Z' }]) assert.equal(orderQuery.safeParse(query).success, false);
    assert.equal(orderParams.safeParse({ orderType: 'APPOINTMENT', orderId: 'bad' }).success, false);
  });
  await check('read-only: persisted order, payment and wallet rows unchanged', async () => {
    const a = await db.appointment.findUniqueOrThrow({ where: { id: f.appointments[0].id } });
    assert.equal(a.paymentStatus, 'UNPAID'); assert.equal(a.qrToken, 'private-qr-1');
    assert.equal(await db.payment.count(), 14); assert.equal(await db.groupPurchase.count(), 10);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: f.customer.id } });
    assert.equal(wallet.paidBalance.toString(), '0');
    assert.equal(await state(), before, 'All persisted commercial and financial records must remain unchanged');
  });
  return results;
}
