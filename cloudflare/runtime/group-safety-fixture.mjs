// Test-only production-service checks against the real Durable Object database.
import { paymentService } from '../../src/app/module/payment/payment.service.ts';
import { walletService } from '../../src/app/module/wallet/wallet.service.ts';
import { groupPurchaseService } from '../../src/app/module/group-purchase/group-purchase.service.ts';
import { groupPurchaseExpiryService } from '../../src/app/module/group-purchase/group-purchase-expiry.service.ts';
import { appointmentService } from '../../src/app/module/appointment/appointment.service.ts';
import { RefundRequestProcessingService } from '../../src/app/module/refund-request/refund-request.processing.ts';
import { stripe } from '../../src/app/lib/stripe.ts';

export async function runGroupSafety(db) {
  const passed = [];
  const check = (value, label) => { if (!value) throw new Error(label); passed.push(label); };
  const rejects = async (fn, label) => { let rejected = false; try { await fn(); } catch { rejected = true; } check(rejected, label); };
  const customer = await db.user.create({ data: { name: 'Group Customer', email: 'group-tests@example.com', passwordHash: 'unused' } });
  const owner = await db.user.findFirst({ where: { role: 'BRAND_OWNER' } });
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const day = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(date).getUTCDay()];
  const branch = await db.branch.create({ data: { name: 'Group Tests', address: 'Hong Kong', bookingPolicy: { create: { minimumBookingNoticeMinutes: 0, depositPercentage: 30 } }, businessHours: { create: { day, openTime: '00:00', closeTime: '23:59' } }, hourlyCapacities: { create: { day, maxBookingsPerHour: 100 } } } });
  const staff = await db.staff.create({ data: { name: 'Group Stylist', email: 'group-staff@example.com', user: { create: { name: 'Group Stylist', email: 'group-staff@example.com', passwordHash: 'unused', role: 'STAFF' } }, roleTitle: 'Stylist', branches: { create: { branchId: branch.id } }, schedule: { create: { branchId: branch.id, day, startTime: '00:00', endTime: '23:59' } } } });
  await db.wallet.create({ data: { customerId: customer.id, paidBalance: 10000, bonusBalance: 1000 } });
  const originals = { create: stripe.refunds.create, retrieve: stripe.refunds.retrieve, list: stripe.refunds.list, intent: stripe.paymentIntents.retrieve };
  const providers = new Map(); const intents = new Map(); let creates = 0; let mode = 'succeeded';
  stripe.paymentIntents.retrieve = async id => intents.get(id);
  stripe.refunds.list = async params => ({ data: [...providers.values()].filter(item => item.payment_intent === params.payment_intent), has_more: false });
  stripe.refunds.retrieve = async id => providers.get(id);
  stripe.refunds.create = async params => {
    creates++;
    const provider = { id: `re_${crypto.randomUUID()}`, payment_intent: params.payment_intent, amount: params.amount, currency: 'hkd', status: mode === 'timeout' ? 'succeeded' : mode, metadata: params.metadata };
    providers.set(provider.id, provider);
    if (mode === 'timeout') throw new Error('Injected timeout after accepted refund');
    return provider;
  };
  const pkg = async capacity => db.package.create({ data: { name: 'Group package', type: 'GROUP_PURCHASE_PACKAGE', regularPrice: '100.25', packagePrice: '100.25', durationMinutes: 30, capacity: capacity ?? 100, branches: { create: { branchId: branch.id } }, staff: { create: { staffId: staff.id } } } });
  const make = async (flow = 'BUY_NOW_BOOK_LATER', method = null, time = '10:00') => {
    const item = await pkg();
    const reserve = method === 'RESERVE_NOW';
    const purchase = await db.groupPurchase.create({ data: { customerId: customer.id, packageId: item.id, quantity: 2, unitPrice: '100.25', amount: '200.50', purchaseFlow: flow, bookingMethod: method, paymentStatus: reserve ? 'UNPAID' : 'PENDING', reservationExpiresAt: reserve ? null : new Date(Date.now() + 300000), depositAmount: method === 'DEPOSIT' ? '60.15' : null, remainingAmount: method === 'DEPOSIT' ? '140.35' : null } });
    await db.package.update({ where: { id: item.id }, data: reserve ? { soldQuantity: 2 } : { reservedQuantity: 2 } });
    if (flow === 'DIRECT_BOOK') await db.appointment.create({ data: { customerId: customer.id, branchId: branch.id, staffId: staff.id, packageId: item.id, groupPurchaseId: purchase.id, bookingMethod: method, appointmentStatus: reserve ? 'RESERVED' : 'PENDING_PAYMENT', paymentStatus: reserve ? 'UNPAID' : 'PENDING', date: new Date(date), startTime: time, endTime: `${time.slice(0, 2)}:30`, price: '100.25', durationMinutes: 30, itemName: 'Group package', holdExpiresAt: reserve ? null : purchase.reservationExpiresAt, qrToken: reserve ? crypto.randomUUID() : null } });
    return purchase;
  };
  const stripePayment = async purchase => {
    const id = `pi_${crypto.randomUUID()}`;
    const payment = await db.payment.create({ data: { customerId: customer.id, groupPurchaseId: purchase.id, purpose: 'GROUP_PURCHASE', amount: purchase.bookingMethod === 'DEPOSIT' ? purchase.depositAmount : purchase.amount, providerPaymentId: id } });
    const intent = { id, amount: payment.amount.mul(100).toNumber(), amount_received: payment.amount.mul(100).toNumber(), currency: 'hkd', status: 'succeeded', metadata: { paymentId: payment.id, groupPurchaseId: purchase.id, customerId: customer.id, purpose: 'GROUP_PURCHASE' } };
    intents.set(id, intent); return { payment, intent };
  };
  const event = type => ({ id: `evt_${crypto.randomUUID()}`, type: type ?? 'payment_intent.succeeded' });
  const settle = async (purchase, type) => { const result = await stripePayment(purchase); await paymentService.handleGroupPurchaseStripeEvent(event(type), result.intent); return result; };
  try {
    // Public creation guard remains deliberately disabled.
    const pack = await pkg();
    await rejects(() => groupPurchaseService.createGroupPurchase(customer.id, { packageId: pack.id, quantity: 1, purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'PAY_NOW', branchId: branch.id, date, startTime: '10:00' }), 'Book Now public creation flag remains disabled');
    const created = await groupPurchaseService.createGroupPurchase(customer.id, { packageId: pack.id, quantity: 1 });
    check(created.amount === 100.25, 'Buy Later creation uses decimal unit price times quantity');
    check((await db.package.findUnique({ where: { id: pack.id } })).reservedQuantity === 1, 'Buy Later reserves inventory');
    const buyLater = await db.groupPurchase.findUnique({ where: { id: created.purchaseId } });
    const paid = await settle(buyLater);
    await paymentService.handleGroupPurchaseStripeEvent(event(), paid.intent);
    const settledPackage = await db.package.findUnique({ where: { id: pack.id } });
    check(settledPackage.soldQuantity === 1 && settledPackage.reservedQuantity === 0, 'Different success events cannot sell inventory twice');
    await paymentService.handleGroupPurchaseStripeEvent(event('payment_intent.payment_failed'), paid.intent);
    check((await db.payment.findUnique({ where: { id: paid.payment.id } })).status === 'PAID', 'Failure event cannot overwrite paid settlement');
    for (const method of ['PAY_NOW', 'DEPOSIT']) {
      const p = await make('DIRECT_BOOK', method, method === 'DEPOSIT' ? '11:00' : '12:00');
      const { intent } = await settle(p);
      let current = await db.groupPurchase.findUnique({ where: { id: p.id }, include: { appointments: true } });
      const a = current.appointments[0];
      check(current.paymentStatus === (method === 'DEPOSIT' ? 'PARTIALLY_PAID' : 'PAID'), `${method} Stripe purchase status`);
      check(a.appointmentStatus === (method === 'DEPOSIT' ? 'RESERVED' : 'CONFIRMED'), `${method} Stripe initial appointment status`);
      check(method === 'DEPOSIT' ? !!a.qrToken : a.qrToken === null, `${method} QR policy`);
      await rejects(() => paymentService.createGroupPurchaseStripeIntent(customer.id, { purchaseId: p.id }), 'Book Now Stripe intent guard remains disabled');
      if (method === 'DEPOSIT') {
        await rejects(() => groupPurchaseService.createGroupPurchaseAppointment(customer.id, p.id, { branchId: branch.id, date, startTime: '15:00' }), 'Partial purchase cannot redeem');
        await rejects(() => groupPurchaseService.recordGroupPurchaseRemainingPayment(p.id, { paymentMethod: 'CASH' }, customer.id, 'CUSTOMER'), 'Customer cannot record salon payment');
        await appointmentService.verifyQr(owner.id, 'BRAND_OWNER', { qrToken: a.qrToken, branchId: branch.id });
        await groupPurchaseService.recordGroupPurchaseRemainingPayment(p.id, { paymentMethod: 'CASH' }, owner.id, 'BRAND_OWNER');
        await rejects(() => groupPurchaseService.recordGroupPurchaseRemainingPayment(p.id, { paymentMethod: 'CASH' }, owner.id, 'BRAND_OWNER'), 'Duplicate salon remaining payment blocked');
        await paymentService.handleGroupPurchaseStripeEvent(event(), intent);
        check(creates === 0, 'Deposit success replay after salon completion never refunds valid deposit');
      }
    }
    for (const method of [null, 'PAY_NOW', 'DEPOSIT']) {
      const p = await make(method ? 'DIRECT_BOOK' : 'BUY_NOW_BOOK_LATER', method, '13:00');
      const before = await db.wallet.findUnique({ where: { customerId: customer.id } });
      const result = await walletService.payGroupPurchaseWithWallet(customer.id, p.id, { useBonus: true });
      check(result.amountPaid === (method === 'DEPOSIT' ? 60.15 : 200.5), `${method ?? 'BUY_LATER'} wallet correct purchase amount`);
      await rejects(() => walletService.payGroupPurchaseWithWallet(customer.id, p.id, { useBonus: true }), `${method ?? 'BUY_LATER'} duplicate wallet debit blocked`);
      const after = await db.wallet.findUnique({ where: { customerId: customer.id } });
      check(before.paidBalance.plus(before.bonusBalance).minus(after.paidBalance.plus(after.bonusBalance)).equals(result.amountPaid), `${method ?? 'BUY_LATER'} wallet ledger conservation`);
      if (!method) {
        const request = await db.refundRequest.create({ data: { customerId: customer.id, paymentId: result.paymentId, amount: p.amount, reason: 'Unused package', status: 'APPROVED', reviewedBy: owner.id, reviewedAt: new Date() } });
        await RefundRequestProcessingService.processApprovedRefund(request.id, owner.id);
        const restored = await db.wallet.findUnique({ where: { customerId: customer.id } });
        check(restored.paidBalance.equals(before.paidBalance) && restored.bonusBalance.equals(before.bonusBalance), 'Wallet group refund restores exact paid and bonus components');
        await rejects(() => RefundRequestProcessingService.processApprovedRefund(request.id, owner.id), 'Duplicate wallet refund cannot credit twice');
      }

    }
    const reserve = await make('DIRECT_BOOK', 'RESERVE_NOW', '14:00');
    await rejects(() => groupPurchaseService.createGroupPurchaseAppointment(customer.id, reserve.id, { branchId: branch.id, date, startTime: '15:00' }), 'Unpaid reserve cannot redeem');
    const ra = await db.appointment.findFirst({ where: { groupPurchaseId: reserve.id } });
    await rejects(() => appointmentService.cancelAppointment(ra.id, customer.id, 'CUSTOMER', { reason: 'Test cancellation' }), 'Initial Book Now cancellation remains protected');
    await rejects(() => appointmentService.verifyQr(customer.id, 'BRANCH_MANAGER', { qrToken: ra.qrToken, branchId: branch.id }), 'Cross-branch manager cannot verify QR');
    await appointmentService.verifyQr(owner.id, 'BRAND_OWNER', { qrToken: ra.qrToken, branchId: branch.id });
    await groupPurchaseService.recordGroupPurchaseRemainingPayment(reserve.id, { paymentMethod: 'CASH' }, owner.id, 'BRAND_OWNER');
    check((await db.groupPurchase.findUnique({ where: { id: reserve.id } })).paymentStatus === 'PAID', 'Reserve QR plus salon payment completes purchase');

    const redeem = await make(); const redeemedPayment = await settle(redeem);
    const payload = { branchId: branch.id, date, startTime: '17:00' };
    await rejects(() => groupPurchaseService.createGroupPurchaseAppointment(owner.id, redeem.id, payload), 'Other customer cannot redeem purchase');
    const first = await groupPurchaseService.createGroupPurchaseAppointment(customer.id, redeem.id, payload);
    await groupPurchaseService.createGroupPurchaseAppointment(customer.id, redeem.id, { ...payload, startTime: '18:00' });
    await rejects(() => groupPurchaseService.createGroupPurchaseAppointment(customer.id, redeem.id, { ...payload, startTime: '19:00' }), 'Redemption cannot exceed purchased quantity');
    await appointmentService.cancelAppointment(first.appointmentId, customer.id, 'CUSTOMER', { reason: 'Change appointment' });
    await groupPurchaseService.createGroupPurchaseAppointment(customer.id, redeem.id, { ...payload, startTime: '17:00' });
    check(await db.appointment.count({ where: { groupPurchaseId: redeem.id, appointmentStatus: { not: 'CANCELLED' } } }) === 2, 'Cancelled redemption releases exactly one entitlement');
    await paymentService.handleGroupPurchaseStripeEvent(event(), redeemedPayment.intent);
    check((await db.package.findUnique({ where: { id: redeem.packageId } })).soldQuantity === 2, 'Settlement replay after multiple redemptions preserves inventory');
    const limited = await pkg(1);
    const concurrent = await Promise.allSettled([1, 2].map(() => groupPurchaseService.createGroupPurchase(customer.id, { packageId: limited.id, quantity: 1 })));
    check(concurrent.filter(result => result.status === 'fulfilled').length === 1, 'Concurrent purchases cannot oversell one capacity');
    const inv = await db.package.findUnique({ where: { id: limited.id } });
    check(inv.soldQuantity >= 0 && inv.reservedQuantity >= 0 && inv.soldQuantity + inv.reservedQuantity <= 1, 'Inventory remains nonnegative and bounded');
    const poor = await make();
    await db.wallet.update({ where: { customerId: customer.id }, data: { paidBalance: 0, bonusBalance: 0 } });
    await rejects(() => walletService.payGroupPurchaseWithWallet(customer.id, poor.id, { useBonus: true }), 'Insufficient wallet balance cannot settle purchase');
    await rejects(() => walletService.payGroupPurchaseWithWallet(owner.id, poor.id, { useBonus: true }), 'Other customer cannot pay purchase');
    const late = await make(); const latePi = await stripePayment(late);
    await db.groupPurchase.update({ where: { id: late.id }, data: { reservationExpiresAt: new Date(0) } });
    await groupPurchaseExpiryService.expirePendingGroupPurchases();
    await groupPurchaseExpiryService.expirePendingGroupPurchases();
    check((await db.package.findUnique({ where: { id: late.packageId } })).reservedQuantity === 0, 'Duplicate expiry releases inventory once');
    const lateEvent = event();
    await paymentService.handleGroupPurchaseStripeEvent(lateEvent, latePi.intent);
    const notes = await db.notification.count({ where: { userId: customer.id, type: 'REFUND_COMPLETED' } });
    await paymentService.handleGroupPurchaseStripeEvent(lateEvent, latePi.intent);
    await paymentService.handleGroupPurchaseStripeEvent(event(), latePi.intent);
    check(creates === 1, 'Late success and duplicate events create one provider refund');
    check((await db.notification.count({ where: { userId: customer.id, type: 'REFUND_COMPLETED' } })) === notes, 'Finalization replay creates no duplicate notification');
    check((await db.groupPurchase.findUnique({ where: { id: late.id } })).paymentStatus === 'FAILED', 'Late success never resurrects expired purchase');

    const protectedDeposit = await make('DIRECT_BOOK', 'DEPOSIT', '20:00');
    await settle(protectedDeposit);
    await db.groupPurchase.update({ where: { id: protectedDeposit.id }, data: { reservationExpiresAt: new Date(0) } });
    const protectedReserve = await make('DIRECT_BOOK', 'RESERVE_NOW', '21:00');
    const expiringNow = await make('DIRECT_BOOK', 'PAY_NOW', '22:00');
    await db.groupPurchase.update({ where: { id: expiringNow.id }, data: { reservationExpiresAt: new Date(0) } });
    await groupPurchaseExpiryService.expirePendingGroupPurchases();
    check((await db.groupPurchase.findUnique({ where: { id: protectedDeposit.id } })).paymentStatus === 'PARTIALLY_PAID', 'Expiry does not affect settled deposit');
    check((await db.groupPurchase.findUnique({ where: { id: protectedReserve.id } })).paymentStatus === 'UNPAID', 'Expiry does not affect reserve-now unpaid purchase');
    check((await db.appointment.findFirst({ where: { groupPurchaseId: expiringNow.id } })).appointmentStatus === 'EXPIRED', 'Group expiry expires initial appointment consistently');
    for (const outcome of ['pending', 'failed', 'timeout']) {
      const p = await make(); const { intent, payment } = await stripePayment(p);
      await db.groupPurchase.update({ where: { id: p.id }, data: { reservationExpiresAt: new Date(0) } });
      mode = outcome;
      await rejects(() => paymentService.handleGroupPurchaseStripeEvent(event(), intent), `${outcome} refund requires retry or investigation`);
      check((await db.payment.findUnique({ where: { id: payment.id } })).status === 'PAID', `${outcome} not displayed as refunded`);
      const count = creates;
      if (outcome === 'timeout') {
        mode = 'succeeded'; await paymentService.handleGroupPurchaseStripeEvent(event(), intent);
        check((await db.payment.findUnique({ where: { id: payment.id } })).status === 'REFUNDED', 'Timeout recovery finalizes accepted Stripe refund');
      } else await rejects(() => paymentService.handleGroupPurchaseStripeEvent(event(), intent), `${outcome} replay stays unresolved`);
      check(creates === count, `${outcome} replay never issues another provider refund`);
    }

    mode = 'succeeded';
    const duplicated = await make(); const originalPayment = await settle(duplicated);
    const doublePayment = await stripePayment(duplicated);
    const refundCreatesBefore = creates;
    await paymentService.handleGroupPurchaseStripeEvent(event(), doublePayment.intent);
    check(creates === refundCreatesBefore + 1, 'Duplicate successful payment is refunded once');
    await paymentService.handleGroupPurchaseStripeEvent(event(), originalPayment.intent);
    check((await db.payment.findUnique({ where: { id: originalPayment.payment.id } })).status === 'PAID', 'Original settlement stays paid after duplicate-payment refund');
    check(creates === refundCreatesBefore + 1, 'Original settlement replay never initiates another refund');
    const pendingWebhook = await make(); const pendingWebhookPayment = await stripePayment(pendingWebhook);
    await db.groupPurchase.update({ where: { id: pendingWebhook.id }, data: { reservationExpiresAt: new Date(0) } });
    mode = 'pending';
    await rejects(() => paymentService.handleGroupPurchaseStripeEvent(event(), pendingWebhookPayment.intent), 'Pending provider refund leaves original event unacknowledged');
    const providerRecord = [...providers.values()].find(item => item.payment_intent === pendingWebhookPayment.intent.id);
    providerRecord.status = 'succeeded';
    const refundEvent = { id: `evt_${crypto.randomUUID()}`, type: 'refund.updated', data: { object: providerRecord } };
    const body = JSON.stringify(refundEvent);
    const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: 'whsec_test' });
    await paymentService.handleStripeWebhook(Buffer.from(body), signature);
    check((await db.payment.findUnique({ where: { id: pendingWebhookPayment.payment.id } })).status === 'REFUNDED', 'Signed refund.updated routes to provider reconciliation and atomic finalization');
    const noteCount = await db.notification.count({ where: { type: 'REFUND_COMPLETED', userId: customer.id } });
    await paymentService.handleStripeWebhook(Buffer.from(body), signature);
    check((await db.notification.count({ where: { type: 'REFUND_COMPLETED', userId: customer.id } })) === noteCount, 'Duplicate signed refund webhook creates no duplicate notification');
    mode = 'succeeded';
    const approvedPurchase = await make(); const approvedPayment = await settle(approvedPurchase);
    const approval = await db.refundRequest.create({ data: { customerId: customer.id, paymentId: approvedPayment.payment.id, amount: approvedPurchase.amount, reason: 'Unused purchase', status: 'APPROVED', reviewedBy: owner.id, reviewedAt: new Date() } });
    mode = 'pending';
    const approvedPending = await RefundRequestProcessingService.processApprovedRefund(approval.id, owner.id);
    check(approvedPending.status === 'PROCESSING', 'Approved group Stripe refund pending is not completed');
    const approvedProvider = [...providers.values()].find(item => item.payment_intent === approvedPayment.intent.id);
    approvedProvider.status = 'succeeded';
    const beforeApprovedReplay = creates;
    const approvedDone = await RefundRequestProcessingService.processApprovedRefund(approval.id, owner.id);
    check(approvedDone.status === 'COMPLETED' && creates === beforeApprovedReplay, 'Admin process retry reconciles approved Stripe refund without creating another refund');
    check((await db.groupPurchase.findUnique({ where: { id: approvedPurchase.id } })).paymentStatus === 'REFUNDED', 'Approved group refund invalidates purchase only after provider success');
    const concurrentRedemption = await Promise.allSettled(['06:00', '07:00'].map(startTime => groupPurchaseService.createGroupPurchaseAppointment(customer.id, buyLater.id, { branchId: branch.id, date, startTime })));
    check(concurrentRedemption.filter(item => item.status === 'fulfilled').length === 1, 'Concurrent redemptions admit only purchased quantity');
    check(await db.appointment.count({ where: { groupPurchaseId: buyLater.id, appointmentStatus: { not: 'CANCELLED' } } }) === 1, 'Concurrent redemption count is bounded');
    const bookNowMultiple = await make('DIRECT_BOOK', 'PAY_NOW', '08:00');
    const multiPayment = await settle(bookNowMultiple);
    await groupPurchaseService.createGroupPurchaseAppointment(customer.id, bookNowMultiple.id, { branchId: branch.id, date, startTime: '09:00' });
    await paymentService.handleGroupPurchaseStripeEvent(event(), multiPayment.intent);
    check((await db.payment.findUnique({ where: { id: multiPayment.payment.id } })).status === 'PAID', 'Book Now settlement replay identifies initial appointment among multiple linked bookings');
    return { passed };
  } finally { stripe.refunds.create = originals.create; stripe.refunds.retrieve = originals.retrieve; stripe.refunds.list = originals.list; stripe.paymentIntents.retrieve = originals.intent; }
}
