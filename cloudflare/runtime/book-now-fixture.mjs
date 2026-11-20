// Included only in the integration build. Public purchase/payment APIs remain real.
import { stripe } from '../../src/app/lib/stripe.ts';
import { generateOrderNumber } from '../../src/app/utils/generateOrderNumber.ts';

const intents = new Map();
const intentKeys = new Map();
const refunds = new Map();
let refundMode='succeeded';
let refundCreateCalls=0;
let failIntentRead=false;
let initialCancelMode = 'normal';
let initialCancelCalls = 0;
let initialIntentReads = 0;
let initialCreateTimeout = false;

function installProviderMocks() {
  stripe.paymentIntents.create = async (params, options) => {
    if (intentKeys.has(options.idempotencyKey)) return intents.get(intentKeys.get(options.idempotencyKey));
    const id = `pi_${crypto.randomUUID()}`;
    const intent = { id, ...params, amount_received: 0, status: 'requires_payment_method', client_secret: `${id}_secret_synthetic` };
    intents.set(id, intent); intentKeys.set(options.idempotencyKey, id);
    if (initialCreateTimeout) { initialCreateTimeout = false; throw new Error('Synthetic timeout after intent creation'); }
    return intent;
  };
  stripe.paymentIntents.retrieve = async id => { initialIntentReads++; if(failIntentRead)throw new Error('Synthetic provider unavailable before submission'); if (!intents.has(id)) throw new Error('Unknown synthetic intent'); return intents.get(id); };
  stripe.paymentIntents.cancel = async id => {
    initialCancelCalls++;
    const intent = intents.get(id);
    if (!intent) throw new Error('Unknown synthetic intent');
    if (initialCancelMode === 'capture') {
      intent.status = 'succeeded'; intent.amount_received = intent.amount;
      throw new Error('Synthetic capture won cancellation race');
    }
    if (intent.status === 'processing' || intent.status === 'succeeded') throw new Error('Synthetic intent cannot be cancelled');
    intent.status = 'canceled';
    if (initialCancelMode === 'timeout') throw new Error('Synthetic timeout after cancellation');
    return intent;
  };
  stripe.refunds.create = async (params, options) => {
    refundCreateCalls++;
    if (refunds.has(options.idempotencyKey)) return refunds.get(options.idempotencyKey);
    const refund = { id: `re_${crypto.randomUUID()}`, ...params, currency: intents.get(params.payment_intent)?.currency ?? 'hkd', status: refundMode==='timeout'?'succeeded':refundMode };
    refunds.set(options.idempotencyKey, refund);
    if(refundMode==='timeout')throw new Error('Synthetic timeout after provider acceptance');
    return refund;
  };
  stripe.refunds.retrieve = async id => [...refunds.values()].find(refund => refund.id === id);
  stripe.refunds.list = async params => ({ data: [...refunds.values()].filter(refund => refund.payment_intent === params.payment_intent), has_more: false });
}
export function groupInitialProviderControl(input = {}) {
  if (input.createTimeout !== undefined) initialCreateTimeout = input.createTimeout;
  if (input.cancelMode) initialCancelMode = input.cancelMode;
  if (input.failRead !== undefined) failIntentRead = input.failRead;
  const intent = input.intentId ? intents.get(input.intentId) : null;
  if (input.status) {
    if (!intent) throw new Error('Unknown synthetic intent');
    intent.status = input.status;
    intent.amount_received = input.status === 'succeeded' ? intent.amount : 0;
  }
  return { cancelCalls: initialCancelCalls, intentReads: initialIntentReads,
    intents: [...intents.values()].map(p => ({ id: p.id, status: p.status })),
    ...(intent ? { event: { id: `evt_${crypto.randomUUID()}`, type: input.status === 'canceled' ? 'payment_intent.canceled' : 'payment_intent.succeeded', data: { object: intent } } } : {}) };
}
export async function bookNowFixture(db, customerId) {
  installProviderMocks();
  const brand = await db.brand.findFirstOrThrow();
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const day = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(date).getUTCDay()];
  const branch = await db.branch.create({ data: { name: 'Public Book Now', address: 'Hong Kong', bookingPolicy: { create: { minimumBookingNoticeMinutes: 0, depositPercentage: 30 } }, businessHours: { create: { day, openTime: '00:00', closeTime: '23:59' } }, hourlyCapacities: { create: { day, maxBookingsPerHour: 100 } } } });
  const customer = await db.user.findUniqueOrThrow({ where: { id: customerId } });
  for (const [email, assigned] of [['book-now-manager@example.com', true], ['book-now-other-manager@example.com', false]]) {
    const manager = await db.user.create({ data: { name: 'Test manager', email, passwordHash: customer.passwordHash, role: 'BRANCH_MANAGER' } });
    if (assigned) await db.branchManagerBranch.create({ data: { userId: manager.id, branchId: branch.id } });
  }
  const staff = await db.staff.create({ data: { name: 'Book Now Stylist', email: 'book-now-staff@example.com', roleTitle: 'Stylist', user: { create: { name: 'Stylist', email: 'book-now-staff@example.com', passwordHash: 'unused', role: 'STAFF' } }, branches: { create: { branchId: branch.id } }, schedule: { create: { branchId: branch.id, day, startTime: '00:00', endTime: '23:59' } } } });
  const item = await db.package.create({ data: { name: 'Book Now Package', type: 'GROUP_PURCHASE_PACKAGE', regularPrice: brand.currency === 'JPY' ? '120' : '120.50', packagePrice: brand.currency === 'JPY' ? '100' : '100.25', durationMinutes: 30, capacity: 100, branches: { create: { branchId: branch.id } }, staff: { create: { staffId: staff.id } } } });
  const service=await db.service.create({data:{name:'Policy haircut',price:300,durationMinutes:30,branches:{create:{branchId:branch.id}},staff:{create:{staffId:staff.id}}}});
  await db.wallet.upsert({ where: { customerId }, create: { customerId, currency: brand.currency, paidBalance: 10000, bonusBalance: 1000 }, update: {} });
  return { packageId: item.id, branchId: branch.id, staffId: staff.id, serviceId:service.id, date };
}

export async function policyTestControl(db,body,storage){
  // Synthetic controls for appointment-expiry reconciliation; test bundle only.
  if (body.appointmentExpiry) {
    const { action, appointmentId } = body.appointmentExpiry;
    if (action === 'legacy') {
      await db.appointment.update({ where: { id: appointmentId }, data: { appointmentStatus: 'EXPIRED', paymentStatus: 'FAILED', holdExpiresAt: null } });
      return { ok: true };
    }
    if (action === 'block' || action === 'unblock') {
      storage.sql.exec('DROP TRIGGER IF EXISTS expiry_test_fail_payment');
      if (action === 'block') storage.sql.exec(`CREATE TRIGGER expiry_test_fail_payment BEFORE UPDATE OF status ON Payment WHEN OLD.status = 'PENDING' AND NEW.status = 'FAILED' BEGIN SELECT RAISE(ABORT, 'Synthetic expiry failure'); END`);
      return { ok: true };
    }
    if (action === 'run') {
      const { appointmentService } = await import('../../src/app/module/appointment/appointment.service.ts');
      try { return { ok: true, ...await appointmentService.expirePendingAppointments(appointmentId) }; }
      catch { return { ok: false }; }
    }
    if (action === 'guards') {
      const a = await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      const pkg = await db.package.findFirstOrThrow();
      const group = await db.groupPurchase.create({ data: { customerId: a.customerId, packageId: pkg.id, currency: a.currency, quantity: 1, unitPrice: 10, amount: 10 } });
      const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: a.customerId } });
      const topup = await db.walletTopup.create({ data: { walletId: wallet.id, amount: 10 } });
      const other = await db.user.findFirstOrThrow({ where: { id: { not: a.customerId } } });
      const payments = [];
      for (const data of [
        { status: 'PAID', paidAt: new Date() }, { status: 'REFUNDED' }, { status: 'PARTIALLY_REFUNDED' },
        { purpose: 'APPOINTMENT_REMAINING' }, { purpose: 'APPOINTMENT' }, { paidAt: new Date() },
        { groupPurchaseId: group.id }, { walletTopupId: topup.id }, { customerId: other.id },
      ]) payments.push(await db.payment.create({ data: { customerId: a.customerId, appointmentId, purpose: 'APPOINTMENT_DEPOSIT', provider: 'SALON', status: 'PENDING', currency: a.currency, amount: 10, ...data } }));
      const linked = await db.appointment.create({ data: { customerId: a.customerId, branchId: a.branchId, groupPurchaseId: group.id,
        orderNumber: generateOrderNumber(), bookingMethod: 'DEPOSIT', appointmentStatus: 'EXPIRED', paymentStatus: 'FAILED',
        date: a.date, startTime: '01:00', endTime: '01:30', durationMinutes: 30, itemName: 'Synthetic group redemption', price: 10, currency: a.currency } });
      payments.push(await db.payment.create({ data: { customerId: a.customerId, appointmentId: linked.id, purpose: 'APPOINTMENT_DEPOSIT', provider: 'STRIPE', status: 'PENDING', currency: a.currency, amount: 10 } }));
      return { payments };
    }
    throw new Error('Unknown synthetic expiry action');
  }
  if (body.paymentCreatedAt) await db.payment.update({ where: { id: body.paymentCreatedAt.id }, data: { createdAt: new Date(body.paymentCreatedAt.value) } });
  // Simulate externally changed legacy settings only in the disposable test build.
  if (body.internationalSettings) {
    const brand = await db.brand.findFirstOrThrow();
    await db.brand.update({ where: { id: brand.id }, data: body.internationalSettings });
  }
  if(body.failIntentRead!==undefined)failIntentRead=body.failIntentRead;
  if(body.restoreProviderState){installProviderMocks();intents.clear();refunds.clear();for(const [k,v] of body.restoreProviderState.intents)intents.set(k,v);for(const [k,v]of body.restoreProviderState.refunds)refunds.set(k,v);refundCreateCalls=body.restoreProviderState.refundCreateCalls;}

  if(body.priorRefundPayment){
    await db.refund.create({data:{paymentId:body.priorRefundPayment,amount:10,reason:'Synthetic historical successful refund',status:'SUCCEEDED',refundedAt:new Date()}});
    await db.payment.update({where:{id:body.priorRefundPayment},data:{status:'PARTIALLY_REFUNDED'}});
  }
  if(body.allocationFailure!==undefined){
    storage.sql.exec('DROP TRIGGER IF EXISTS test_allocation_refund_failure');
    storage.sql.exec('DROP TRIGGER IF EXISTS test_allocation_wallet_failure');
    if(body.allocationFailure==='stripe')storage.sql.exec("CREATE TRIGGER test_allocation_refund_failure BEFORE UPDATE ON Refund WHEN NEW.status='SUCCEEDED' AND EXISTS (SELECT 1 FROM Payment WHERE id=NEW.paymentId AND provider='STRIPE') BEGIN SELECT RAISE(ABORT,'synthetic accepted refund persistence failure'); END");
    if(body.allocationFailure==='wallet')storage.sql.exec("CREATE TRIGGER test_allocation_wallet_failure BEFORE INSERT ON WalletTransaction WHEN NEW.type='REFUND' BEGIN SELECT RAISE(ABORT,'synthetic wallet ledger failure'); END");
  }
  if(body.legacyWalletPurchase){
    const payments=await db.payment.findMany({where:{groupPurchaseId:body.legacyWalletPurchase,provider:'WALLET'}});
    await db.walletTransaction.updateMany({where:{paymentId:{in:payments.map(p=>p.id)},type:'GROUP_PURCHASE_PAYMENT'},data:{paymentId:null,ledgerKey:null,referenceId:body.legacyWalletPurchase}});
  }

  if (body.autoStaff) {
    const { branchId, serviceId, packageId, date } = body.autoStaff;
    const day = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date(date).getUTCDay()];
    if (body.autoStaff.durationMinutes) await db.service.update({ where: { id: serviceId }, data: { durationMinutes: body.autoStaff.durationMinutes } });
    if (body.autoStaff.maxBookingsPerHour) await db.branchHourlyCapacity.update({ where: { branchId_day: { branchId, day } }, data: { maxBookingsPerHour: body.autoStaff.maxBookingsPerHour } });
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const email = `auto-${crypto.randomUUID()}@example.com`;
      const staff = await db.staff.create({ data: {
        name: 'AUTO fixture', email, roleTitle: 'Stylist', user: { create: { name: 'AUTO fixture', email, passwordHash: 'unused', role: 'STAFF' } },
        branches: { create: { branchId } }, services: { create: { serviceId } }, packages: { create: { packageId } },
        schedule: { create: { branchId, day, startTime: '00:00', endTime: '23:59' } },
      } });
      ids.push(staff.id);
    }
    return { staffIds: ids };
  }
  if (body.legacyGroupDeposit) {
    // DIRECT_BOOK creation was retired; existing deposits still need settlement.
    // Seed the historical persisted state, then exercise real payment/QR APIs.
    const { customerId, branchId, staffId, packageId, date, startTime } = body.legacyGroupDeposit;
    const purchase = await db.groupPurchase.create({ data: {
      customerId, packageId, purchaseBranchId: branchId, orderNumber: generateOrderNumber(),
      purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'DEPOSIT', quantity: 2,
      unitPrice: 100.25, amount: 200.5, currency: 'HKD', depositPercentage: 30,
      depositAmount: 60.15, remainingAmount: 140.35, paymentStatus: 'PARTIALLY_PAID', purchasedAt: new Date(),
    } });
    const appointment = await db.appointment.create({ data: {
      customerId, branchId, staffId, packageId, groupPurchaseId: purchase.id, orderNumber: generateOrderNumber(),
      bookingMethod: 'DEPOSIT', appointmentStatus: 'RESERVED', paymentStatus: 'PARTIALLY_PAID',
      date: new Date(date), startTime, endTime: `${String(Number(startTime.slice(0,2)) + 1).padStart(2,'0')}:00`,
      durationMinutes: 60, itemName: 'Legacy group deposit', price: 200.5, currency: 'HKD', timezone: 'Asia/Hong_Kong',
      depositPercentage: 30, depositAmount: 60.15, remainingAmount: 140.35, qrToken: crypto.randomUUID(),
    } });
    const deposit = await db.payment.create({ data: {
      customerId, groupPurchaseId: purchase.id, appointmentId: appointment.id, purpose: 'GROUP_PURCHASE',
      provider: 'WALLET', status: 'PAID', amount: 60.15, currency: 'HKD', paidAt: new Date(),
    } });
    await db.groupPurchase.update({ where: { id: purchase.id }, data: { settledPaymentId: deposit.id } });
    return { purchaseId: purchase.id, appointmentId: appointment.id };
  }
  if (body.remainingDeposit) {
    const { customerId, branchId, staffId, serviceId, date } = body.remainingDeposit;
    const appointment = await db.appointment.create({ data: {
      customerId, branchId, staffId, serviceId, orderNumber: generateOrderNumber(),
      bookingMethod: 'DEPOSIT', appointmentStatus: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID',
      date: new Date(date), startTime: '06:00', endTime: '06:30', durationMinutes: 30,
      itemName: 'Remaining payment test', price: 300, depositPercentage: 30, depositAmount: 90,
      remainingAmount: 210, qrVerifiedAt: new Date(),
    } });
    await db.payment.create({ data: { customerId, appointmentId: appointment.id, purpose: 'APPOINTMENT_DEPOSIT', provider: 'WALLET', status: 'PAID', amount: 90, paidAt: new Date() } });
    return { appointmentId: appointment.id };
  }
  if(body.packageId&&body.validDays!==undefined)await db.package.update({where:{id:body.packageId},data:{validDays:body.validDays}});
  if(body.refundMode)refundMode=body.refundMode;
  if(body.appointmentId){
    const data={};
    if(body.hoursBefore!==undefined){const hk=new Date(Date.now()+body.hoursBefore*3600000+8*3600000);data.date=new Date(hk.toISOString().slice(0,10));data.startTime=hk.toISOString().slice(11,16);}
    if(body.status)data.appointmentStatus=body.status;
    if(body.clearSnapshot)data.cancellationPolicySnapshot=null;
    await db.appointment.update({where:{id:body.appointmentId},data});
  }
  if(body.purchaseId&&body.ageHours!==undefined)await db.groupPurchase.update({where:{id:body.purchaseId},data:{purchasedAt:new Date(Date.now()-body.ageHours*3600000)}});
  if(body.refundStatus){const refund=[...refunds.values()].find(r=>r.id===body.providerRefundId);if(!refund)throw new Error('Unknown synthetic refund');refund.status=body.refundStatus;return {id:`evt_${crypto.randomUUID()}`,type:'refund.updated',data:{object:refund}};}
  return {providerState:{intents:[...intents],refunds:[...refunds],refundCreateCalls},providerRefundCreateCalls:refundCreateCalls,providerRefundCount:refunds.size,providerRefunds:[...refunds.values()],requests:await db.refundRequest.findMany()};
}

export async function providerEvent(db, body) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: body.paymentId } });
  const intent = intents.get(payment.providerPaymentId);
  if (!intent) throw new Error('Unknown test payment');
  intent.status = body.failed ? 'requires_payment_method' : 'succeeded';
  intent.amount_received = body.failed ? 0 : intent.amount;
  return { id: `evt_${crypto.randomUUID()}`, type: body.failed ? 'payment_intent.payment_failed' : 'payment_intent.succeeded', data: { object: intent } };
}
