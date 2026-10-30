// Included only in the integration build. Public purchase/payment APIs remain real.
import { stripe } from '../../src/app/lib/stripe.ts';
import { generateOrderNumber } from '../../src/app/utils/generateOrderNumber.ts';

const intents = new Map();
const intentKeys = new Map();
const refunds = new Map();
let refundMode='succeeded';
let refundCreateCalls=0;
let failIntentRead=false;

function installProviderMocks() {
  stripe.paymentIntents.create = async (params, options) => {
    if (intentKeys.has(options.idempotencyKey)) return intents.get(intentKeys.get(options.idempotencyKey));
    const id = `pi_${crypto.randomUUID()}`;
    const intent = { id, ...params, amount_received: 0, status: 'requires_payment_method', client_secret: `${id}_secret_synthetic` };
    intents.set(id, intent); intentKeys.set(options.idempotencyKey, id); return intent;
  };
  stripe.paymentIntents.retrieve = async id => { if(failIntentRead)throw new Error('Synthetic provider unavailable before submission'); if (!intents.has(id)) throw new Error('Unknown synthetic intent'); return intents.get(id); };
  stripe.refunds.create = async (params, options) => {
    refundCreateCalls++;
    if (refunds.has(options.idempotencyKey)) return refunds.get(options.idempotencyKey);
    const refund = { id: `re_${crypto.randomUUID()}`, ...params, currency: 'hkd', status: refundMode==='timeout'?'succeeded':refundMode };
    refunds.set(options.idempotencyKey, refund);
    if(refundMode==='timeout')throw new Error('Synthetic timeout after provider acceptance');
    return refund;
  };
  stripe.refunds.retrieve = async id => [...refunds.values()].find(refund => refund.id === id);
  stripe.refunds.list = async params => ({ data: [...refunds.values()].filter(refund => refund.payment_intent === params.payment_intent), has_more: false });
}
export async function bookNowFixture(db, customerId) {
  installProviderMocks();
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const day = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(date).getUTCDay()];
  const branch = await db.branch.create({ data: { name: 'Public Book Now', address: 'Hong Kong', bookingPolicy: { create: { minimumBookingNoticeMinutes: 0, depositPercentage: 30 } }, businessHours: { create: { day, openTime: '00:00', closeTime: '23:59' } }, hourlyCapacities: { create: { day, maxBookingsPerHour: 100 } } } });
  const customer = await db.user.findUniqueOrThrow({ where: { id: customerId } });
  for (const [email, assigned] of [['book-now-manager@example.com', true], ['book-now-other-manager@example.com', false]]) {
    const manager = await db.user.create({ data: { name: 'Test manager', email, passwordHash: customer.passwordHash, role: 'BRANCH_MANAGER' } });
    if (assigned) await db.branchManagerBranch.create({ data: { userId: manager.id, branchId: branch.id } });
  }
  const staff = await db.staff.create({ data: { name: 'Book Now Stylist', email: 'book-now-staff@example.com', roleTitle: 'Stylist', user: { create: { name: 'Stylist', email: 'book-now-staff@example.com', passwordHash: 'unused', role: 'STAFF' } }, branches: { create: { branchId: branch.id } }, schedule: { create: { branchId: branch.id, day, startTime: '00:00', endTime: '23:59' } } } });
  const item = await db.package.create({ data: { name: 'Book Now Package', type: 'GROUP_PURCHASE_PACKAGE', regularPrice: '120.50', packagePrice: '100.25', durationMinutes: 30, capacity: 100, branches: { create: { branchId: branch.id } }, staff: { create: { staffId: staff.id } } } });
  const service=await db.service.create({data:{name:'Policy haircut',price:300,durationMinutes:30,branches:{create:{branchId:branch.id}},staff:{create:{staffId:staff.id}}}});
  await db.wallet.upsert({ where: { customerId }, create: { customerId, paidBalance: 10000, bonusBalance: 1000 }, update: {} });
  return { packageId: item.id, branchId: branch.id, staffId: staff.id, serviceId:service.id, date };
}

export async function policyTestControl(db,body,storage){
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
