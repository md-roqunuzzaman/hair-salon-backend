// Included only in the integration build. Public purchase/payment APIs remain real.
import { stripe } from '../../src/app/lib/stripe.ts';

const intents = new Map();
const intentKeys = new Map();
const refunds = new Map();

export async function bookNowFixture(db, customerId) {
  stripe.paymentIntents.create = async (params, options) => {
    if (intentKeys.has(options.idempotencyKey)) return intents.get(intentKeys.get(options.idempotencyKey));
    const id = `pi_${crypto.randomUUID()}`;
    const intent = { id, ...params, amount_received: 0, status: 'requires_payment_method', client_secret: `${id}_secret_synthetic` };
    intents.set(id, intent); intentKeys.set(options.idempotencyKey, id); return intent;
  };
  stripe.paymentIntents.retrieve = async id => { if (!intents.has(id)) throw new Error('Unknown synthetic intent'); return intents.get(id); };
  stripe.refunds.create = async (params, options) => {
    if (refunds.has(options.idempotencyKey)) return refunds.get(options.idempotencyKey);
    const refund = { id: `re_${crypto.randomUUID()}`, ...params, currency: 'hkd', status: 'succeeded' };
    refunds.set(options.idempotencyKey, refund); return refund;
  };
  stripe.refunds.retrieve = async id => [...refunds.values()].find(refund => refund.id === id);
  stripe.refunds.list = async params => ({ data: [...refunds.values()].filter(refund => refund.payment_intent === params.payment_intent), has_more: false });
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const day = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(date).getUTCDay()];
  const branch = await db.branch.create({ data: { name: 'Public Book Now', address: 'Hong Kong', bookingPolicy: { create: { minimumBookingNoticeMinutes: 0, depositPercentage: 30 } }, businessHours: { create: { day, openTime: '00:00', closeTime: '23:59' } }, hourlyCapacities: { create: { day, maxBookingsPerHour: 100 } } } });
  const staff = await db.staff.create({ data: { name: 'Book Now Stylist', email: 'book-now-staff@example.com', roleTitle: 'Stylist', user: { create: { name: 'Stylist', email: 'book-now-staff@example.com', passwordHash: 'unused', role: 'STAFF' } }, branches: { create: { branchId: branch.id } }, schedule: { create: { branchId: branch.id, day, startTime: '00:00', endTime: '23:59' } } } });
  const item = await db.package.create({ data: { name: 'Book Now Package', type: 'GROUP_PURCHASE_PACKAGE', regularPrice: '120.50', packagePrice: '100.25', durationMinutes: 30, capacity: 100, branches: { create: { branchId: branch.id } }, staff: { create: { staffId: staff.id } } } });
  await db.wallet.upsert({ where: { customerId }, create: { customerId, paidBalance: 10000, bonusBalance: 1000 }, update: {} });
  return { packageId: item.id, branchId: branch.id, staffId: staff.id, date };
}

export async function providerEvent(db, body) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: body.paymentId } });
  const intent = intents.get(payment.providerPaymentId);
  if (!intent) throw new Error('Unknown test payment');
  intent.status = body.failed ? 'requires_payment_method' : 'succeeded';
  intent.amount_received = body.failed ? 0 : intent.amount;
  return { id: `evt_${crypto.randomUUID()}`, type: body.failed ? 'payment_intent.payment_failed' : 'payment_intent.succeeded', data: { object: intent } };
}
