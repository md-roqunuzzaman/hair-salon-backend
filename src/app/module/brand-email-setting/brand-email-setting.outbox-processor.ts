import { BUSINESS_EMAIL_RETIREMENT_REASON } from './brand-email-setting.retirement.js';

// Compatibility exports only: no database access, provider resolution or retry.
// EMAIL_OUTBOX_ENABLED=true cannot revive the retired delivery subsystem.
export const recoverStaleBusinessEmails = async () => ({ recovered: 0, uncertain: 0, retired: true, reason: BUSINESS_EMAIL_RETIREMENT_REASON });
export const processOneBusinessEmail = async (_emailId: string) => ({ processed: false, retired: true, reason: BUSINESS_EMAIL_RETIREMENT_REASON });
export const processBusinessEmailBatch = async (_limit = 10) => ({ enabled: false, processed: 0, retired: true, reason: BUSINESS_EMAIL_RETIREMENT_REASON });
