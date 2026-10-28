import cron from 'node-cron';
import { processBusinessEmailBatch } from '../module/brand-email-setting/brand-email-setting.outbox-processor.js';

export function startEmailOutboxJob() {
  if (process.env.EMAIL_OUTBOX_ENABLED !== 'true') return;
  let running = false;
  return cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try { await processBusinessEmailBatch(); }
    catch { console.error('[Email Outbox]', { code: 'EMAIL_BATCH_STORAGE_FAILED' }); }
    finally { running = false; }
  });
}
