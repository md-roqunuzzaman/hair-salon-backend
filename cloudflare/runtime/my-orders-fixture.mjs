// Imported by the disposable integration Worker only, never the deployed entry.
export async function myOrdersFixture(db, body) {
  if (body.inspect) return {
    payments: await db.payment.findMany({ select: { id: true, orderNumber: true, walletTopupId: true, amount: true, purpose: true } }),
    appointments: await db.appointment.findMany({ select: { id: true, orderNumber: true } }),
    purchases: await db.groupPurchase.findMany({ select: { id: true, orderNumber: true } }),
  };
  const customer = await db.user.findUniqueOrThrow({ where: { email: 'book-now-customer@example.com' } });
  const { branchId, staffId, serviceId, packageId, date } = body;
  const translations = (en, cn, hk) => ({ en: { name: en }, 'zh-CN': { name: cn }, 'zh-HK': { name: hk } });
  await db.package.update({ where: { id: packageId }, data: { translations: translations('Voucher EN', 'Voucher CN', 'Voucher HK') } });
  await db.service.update({ where: { id: serviceId }, data: { translations: translations('Cut EN', 'Cut CN', 'Cut HK') } });
  await db.packageService.upsert({ where: { packageId_serviceId: { packageId, serviceId } }, create: { packageId, serviceId }, update: {} });
  const second = await db.service.create({ data: { name: 'Fallback wash', price: 10, durationMinutes: 15 } });
  await db.packageService.create({ data: { packageId, serviceId: second.id } });
  const purchase = await db.groupPurchase.create({ data: { customerId: customer.id, packageId, currency: 'HKD', quantity: 2,
    unitPrice: 123, amount: 246, orderNumber: 'G2ABCD', purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'DEPOSIT' } });
  const appointment = await db.appointment.create({ data: { customerId: customer.id, branchId, staffId, serviceId,
    orderNumber: 'A2BCDE', bookingMethod: 'DEPOSIT', appointmentStatus: 'CONFIRMED', paymentStatus: 'PENDING',
    date: new Date(date), startTime: '02:00', endTime: '02:30', durationMinutes: 30, price: 123,
    currency: 'HKD', timezone: 'Asia/Hong_Kong', itemName: 'Snapshot cut', itemNameTranslations: translations('Snapshot EN', 'Snapshot CN', 'Snapshot HK') } });
  const groupAppointment = await db.appointment.create({ data: { customerId: customer.id, branchId, staffId, packageId, groupPurchaseId: purchase.id,
    orderNumber: purchase.orderNumber, bookingMethod: 'DEPOSIT', appointmentStatus: 'CONFIRMED', paymentStatus: 'PENDING',
    date: new Date(date), startTime: '03:00', endTime: '03:30', durationMinutes: 30, price: 0,
    currency: 'HKD', timezone: 'Asia/Hong_Kong', itemName: 'Group snapshot' } });
  const make = data => db.payment.create({ data: { customerId: customer.id, currency: 'HKD', amount: 123, status: 'PENDING', ...data } });
  const initial = await make({ purpose: 'GROUP_PURCHASE', groupPurchaseId: purchase.id, amount: 73.8 });
  const remaining = await make({ purpose: 'GROUP_PURCHASE', groupPurchaseId: purchase.id, amount: 172.2 });
  const linkedOnly = await make({ purpose: 'APPOINTMENT_REMAINING', appointmentId: groupAppointment.id });
  const unlinked = await make({ purpose: 'GROUP_PURCHASE', orderNumber: 'U2BCDE' });
  const deposit = await make({ purpose: 'APPOINTMENT_DEPOSIT', appointmentId: appointment.id, orderNumber: 'P2BCDE', amount: 30 });
  const regularRemaining = await make({ purpose: 'APPOINTMENT_REMAINING', appointmentId: appointment.id, orderNumber: 'Q2BCDE', amount: 93 });
  const orphan = await make({ purpose: 'APPOINTMENT', orderNumber: 'R2BCDE' });
  const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: customer.id } });
  const topup = await db.walletTopup.create({ data: { walletId: wallet.id, amount: 123 } });
  const firstTopup = await make({ purpose: 'WALLET_TOP_UP', walletTopupId: topup.id, orderNumber: 'W2BCDE', createdAt: new Date('2026-01-01') });
  const secondTopup = await make({ purpose: 'WALLET_TOP_UP', walletTopupId: topup.id, orderNumber: 'X2BCDE', status: 'PAID' });
  const other = await db.user.create({ data: { name: 'Other synthetic customer', email: 'orders-other@example.com', passwordHash: 'synthetic', role: 'CUSTOMER' } });
  const otherPayment = await make({ purpose: 'WALLET_TOP_UP', customerId: other.id, orderNumber: 'O2BCDE' });
  const promotion = await db.promotion.create({ data: { name: 'Synthetic topup', minimumTopup: 123, bonusAmount: 10,
    startAt: new Date(Date.now() - 86400000), endAt: new Date(Date.now() + 86400000) } });
  return { initial, remaining, linkedOnly, unlinked, deposit, regularRemaining, orphan, firstTopup, secondTopup, otherPayment,
    purchaseId: purchase.id, appointmentId: appointment.id, topupId: topup.id, promotionId: promotion.id, customerId: customer.id };
}
