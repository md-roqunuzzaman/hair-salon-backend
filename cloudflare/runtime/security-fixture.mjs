// Disposable Worker HTTP verification only; excluded from the production entry.
import { safeResult, valid } from '../test-support/tencent-responses.mjs';

const logs = [];
let capturing = false;
let providerInstalled = false;
let response = valid(safeResult);
let providerFailure = false;
let providerCalls = 0;
let blockedProviderCalls = 0;
let sequence = 0;

export function captureSecurityLog(...args) {
  if (capturing) {
    logs.push(args);
    if (logs.length > 300) logs.shift();
  }
}

export async function securityTestControl(db, body) {
  if (!providerInstalled) {
    providerInstalled = true;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const host = new URL(typeof input === 'string' ? input : input.url ?? String(input)).hostname;
      if (['tms.tencentcloudapi.com', 'ims.tencentcloudapi.com'].includes(host)) {
        providerCalls++;
        if (providerFailure) throw new Error('synthetic provider diagnostic; never public');
        return new Response(response === undefined ? undefined : JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
      }
      if (host === 'api.openai.com' || host.endsWith('.tencentcloudapi.com')) {
        blockedProviderCalls++;
        throw new Error('Unmocked moderation network access blocked by disposable fixture');
      }
      return originalFetch(input, init);
    };
  }
  if ('moderationResponse' in body) response = body.moderationResponse;
  if ('providerFailure' in body) providerFailure = body.providerFailure;
  if ('capture' in body) capturing = body.capture;
  if (body.clearLogs) logs.length = 0;
  let appointmentId;
  if (body.seedAppointment) {
    const customer = await db.user.findUniqueOrThrow({ where: { email: 'book-now-customer@example.com' } });
    const appointment = await db.appointment.create({ data: {
      customerId: customer.id, branchId: body.seedAppointment.branchId,
      staffId: body.seedAppointment.staffId, serviceId: body.seedAppointment.serviceId,
      orderNumber: `S6${String(++sequence).padStart(4, '0')}`, bookingMethod: 'PAY_NOW',
      appointmentStatus: 'COMPLETED', paymentStatus: 'PAID', price: 100, durationMinutes: 30,
      date: new Date(body.seedAppointment.date), startTime: '10:00', endTime: '10:30',
      itemName: 'Synthetic completed service', completedAt: new Date(),
    } });
    appointmentId = appointment.id;
  }
  const review = body.reviewId ? await db.review.findUnique({ where: { id: body.reviewId }, select: {
    id: true, moderationStatus: true, moderationReason: true, replyText: true,
  } }) : null;
  return { appointmentId, review, providerCalls, blockedProviderCalls, logs: [...logs],
    notificationCount: await db.notification.count(), webhookEventCount: await db.stripeWebhookEvent.count() };
}
