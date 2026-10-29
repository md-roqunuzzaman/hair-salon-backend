import cron from 'node-cron';
import { processBusinessEmailBatch } from '../module/brand-email-setting/brand-email-setting.outbox-processor.js';
export function startEmailOutboxJob() {
  return cron.schedule('* * * * *', async () => {
    try { await processBusinessEmailBatch(10); }
    catch { console.error('[Email Outbox]', { code:'EMAIL_BATCH_STORAGE_FAILED' }); }
  }, { noOverlap:true });
}
