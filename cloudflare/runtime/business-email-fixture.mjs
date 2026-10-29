// Disposable integration fixtures only; no production entry imports this file.
import { processOneBusinessEmail, processBusinessEmailBatch, recoverStaleBusinessEmails } from '../../src/app/module/brand-email-setting/brand-email-setting.outbox-processor.ts';
import { enqueueAppointmentEmail, enqueueRefundEmail, collectBusinessEmailEvents } from '../../src/app/module/brand-email-setting/brand-email-setting.events.ts';
import { setEmailMockOnData } from './email-test-fixture.mjs';

export async function businessEmailTestControl(db, storage, body) {
  if (body.collect) return collectBusinessEmailEvents();
  if (body.failSettingRead !== undefined) storage.sql.exec(body.failSettingRead
    ? 'ALTER TABLE BrandEmailSetting RENAME TO _TestUnavailableBrandEmailSetting'
    : 'ALTER TABLE _TestUnavailableBrandEmailSetting RENAME TO BrandEmailSetting');
  if (body.failEmailStorage !== undefined) {
    storage.sql.exec('DROP TRIGGER IF EXISTS test_email_insert_failure');
    if (body.failEmailStorage) storage.sql.exec("CREATE TRIGGER test_email_insert_failure BEFORE INSERT ON EmailOutbox BEGIN SELECT RAISE(ABORT,'synthetic email storage failure'); END");
  }
  if (body.appointmentPatch) await db.appointment.update({where:{id:body.appointmentPatch.id},data:body.appointmentPatch.data});
  if (body.failHistory !== undefined) {
    storage.sql.exec('DROP TRIGGER IF EXISTS test_email_history_failure');
    if (body.failHistory) storage.sql.exec("CREATE TRIGGER test_email_history_failure BEFORE INSERT ON EmailOutboxHistory WHEN NEW.status='SENT' BEGIN SELECT RAISE(ABORT,'synthetic history failure'); END");
  }
  if (body.enqueueAgain) await db.$transaction(tx => enqueueAppointmentEmail(tx,body.enqueueAgain,'RESERVE_NOW_RESERVED'));
  if (body.badRefund) {
    const a = await db.appointment.findFirstOrThrow();
    const owner = await db.user.findFirstOrThrow({where:{role:'BRAND_OWNER'}});
    return db.$transaction(async tx => {
      const payment = await tx.payment.create({data:{customerId:owner.id,appointmentId:a.id,purpose:'APPOINTMENT',provider:'WALLET',amount:10,status:'REFUNDED'}});
      const refund = await tx.refund.create({data:{paymentId:payment.id,amount:10,status:'SUCCEEDED',reason:'Synthetic cross-customer rejection',refundedAt:new Date()}});
      return {emailEnqueued:!!(await enqueueRefundEmail(tx,refund.id))};
    });
  }
  if (body.seed) {
    const brand = await db.brand.findFirst();
    const job = await db.emailOutbox.create({ data: { brandId: brand.id, eventType: 'BOOKING_CANCELLED', idempotencyKey: crypto.randomUUID(), recipientEmail: 'synthetic@example.com', subject: 'Synthetic', html: '<p>Synthetic</p>', text: 'Synthetic', ...body.seed } });
    return { id: job.id };
  }
  if (body.patch) await db.emailOutbox.update({ where: { id: body.patch.id }, data: { ...body.patch.data, ...(body.patch.expired ? { lockedUntil: new Date(0) } : {}), ...(body.patch.ready ? { nextAttemptAt: new Date(0) } : {}) } });
  if (body.recover) return recoverStaleBusinessEmails();
  if (body.failFinalize !== undefined) {
    storage.sql.exec('DROP TRIGGER IF EXISTS test_email_finalize_failure');
    if (body.failFinalize) storage.sql.exec("CREATE TRIGGER test_email_finalize_failure BEFORE UPDATE ON EmailOutbox WHEN NEW.status='SENT' BEGIN SELECT RAISE(ABORT,'synthetic finalize failure'); END");
  }
  if (body.stealDuringSend) setEmailMockOnData(async () => {
    await db.emailOutbox.update({ where: { id: body.stealDuringSend }, data: { claimToken: 'replacement-fence', lockedUntil: new Date(0) } });
    await recoverStaleBusinessEmails();
  });
  if (body.one) return Promise.all(Array.from({ length: body.concurrent || 1 }, () => processOneBusinessEmail(body.one)));
  if (body.batch) return processBusinessEmailBatch(body.batch);
  if (body.rollback) {
    let rolledBack = false;
    try { await db.$transaction(async tx => {
      const a = await tx.appointment.findUniqueOrThrow({ where: { id: body.rollback } });
      await tx.appointment.update({ where: { id: a.id }, data: { startTime: '23:00', endTime: '23:30' } });
      await enqueueAppointmentEmail(tx, a.id, 'BOOKING_RESCHEDULED', a);
      throw Error('SYNTHETIC_ROLLBACK');
    }); } catch { rolledBack = true; }
    return { rolledBack };
  }
  if (body.language) {
    const customer = await db.user.findUniqueOrThrow({ where: { email: 'book-now-customer@example.com' } });
    await db.user.update({ where: { id: customer.id }, data: { preferredLanguage: body.language, name: 'Customer <script>&' } });
    if (body.invalidEmail) await db.user.update({ where: { id: customer.id }, data: { email: 'invalid-recipient' } });
    await db.service.updateMany({ data: { translations: { 'zh-CN': { name: '简体剪发' }, 'zh-HK': { name: '繁體剪髮' } } } });
  }
  if (body.refund) await db.$transaction(tx => enqueueRefundEmail(tx,body.refund));
  return { jobs: await db.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } }) };
}
