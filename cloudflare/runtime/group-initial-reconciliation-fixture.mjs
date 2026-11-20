// Disposable integration bundle only. No route is present in production builds.
import { stripe } from '../../src/app/lib/stripe.ts';
import { groupPurchaseExpiryService } from '../../src/app/module/group-purchase/group-purchase-expiry.service.ts';
import { generateOrderNumber } from '../../src/app/utils/generateOrderNumber.ts';
import { groupInitialProviderControl } from './book-now-fixture.mjs';

export async function groupInitialReconciliationFixture(db, storage, body) {
  if (body.action === 'provider') return groupInitialProviderControl(body);
  if (body.action === 'run') {
    try { return { ok: true, ...await groupPurchaseExpiryService.expirePendingGroupPurchases() }; }
    catch { return { ok: false }; }
  }
  if (body.action === 'legacyFailed') {
    await db.groupPurchase.update({ where: { id: body.purchaseId }, data: { paymentStatus: 'FAILED', reservationExpiresAt: null } });
    return { ok: true };
  }
  if (body.action === 'block' || body.action === 'unblock') {
    storage.sql.exec('DROP TRIGGER IF EXISTS group_initial_test_fail_payment');
    if (body.action === 'block') storage.sql.exec(`CREATE TRIGGER group_initial_test_fail_payment BEFORE UPDATE OF status ON Payment WHEN OLD.status = 'PENDING' AND NEW.status = 'FAILED' AND NEW.groupPurchaseId IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Synthetic group reconciliation write failure'); END`);
    return { ok: true };
  }
  if (body.action === 'legacy') {
    const { customerId, packageId, branchId, staffId, date } = body;
    const deposit = body.bookingMethod === 'DEPOSIT';
    const purchase = await db.groupPurchase.create({ data: {
      customerId, packageId, purchaseBranchId: branchId, quantity: 1, orderNumber: generateOrderNumber(),
      unitPrice: 100.25, amount: 100.25, currency: 'HKD', validDaysSnapshot: 30,
      purchaseFlow: 'DIRECT_BOOK', bookingMethod: body.bookingMethod, paymentStatus: 'PENDING',
      depositPercentage: deposit ? 30 : null, depositAmount: deposit ? 30.08 : null,
      remainingAmount: deposit ? 70.17 : null, reservationExpiresAt: new Date(Date.now() + 300000),
    } });
    await db.package.update({ where: { id: packageId }, data: { reservedQuantity: { increment: 1 } } });
    await db.appointment.create({ data: { customerId, packageId, branchId, staffId, groupPurchaseId: purchase.id,
      orderNumber: generateOrderNumber(), bookingMethod: body.bookingMethod, appointmentStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING',
      date: new Date(date), startTime: body.bookingMethod === 'DEPOSIT' ? '18:00' : '17:00', endTime: '19:00',
      durationMinutes: 60, price: 100.25, currency: 'HKD', itemName: 'Historical direct group purchase',
      depositAmount: deposit ? 30.08 : null, remainingAmount: deposit ? 70.17 : null,
      holdExpiresAt: purchase.reservationExpiresAt } });
    return { purchaseId: purchase.id };
  }
  if (body.action === 'duplicate') {
    const purchase = await db.groupPurchase.findUniqueOrThrow({ where: { id: body.purchaseId } });
    const amount = purchase.bookingMethod === 'DEPOSIT' ? purchase.depositAmount : purchase.amount;
    const payment = await db.payment.create({ data: { customerId: purchase.customerId, groupPurchaseId: purchase.id,
      purpose: 'GROUP_PURCHASE', provider: 'STRIPE', status: 'PENDING', amount, currency: purchase.currency } });
    const intent = await stripe.paymentIntents.create({ amount: Math.round(Number(amount) * 100), currency: purchase.currency.toLowerCase(),
      metadata: { paymentId: payment.id, customerId: purchase.customerId, groupPurchaseId: purchase.id,
        purpose: 'GROUP_PURCHASE', purchaseFlow: purchase.purchaseFlow, bookingMethod: purchase.bookingMethod ?? 'NONE' } },
      { idempotencyKey: `synthetic-duplicate-${payment.id}` });
    await db.payment.update({ where: { id: payment.id }, data: { providerPaymentId: intent.id } });
    return { paymentId: payment.id, intentId: intent.id };
  }
  throw new Error('Unknown synthetic group initial action');
}
