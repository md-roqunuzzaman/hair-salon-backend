import type { Language } from '../../utils/language.js';
import type { INotificationTranslations } from './notification.interface.js';
import { notificationTemplates as templates } from './notification.templates.js';
import { notificationName } from './notification.names.js';

type StoredNotification = { type: string; title: string; message: string; translations?: unknown };
const generic = {
  en: { title: 'Notification', message: 'This notification is not available in the selected language. Switch language to view the original content.' },
  'zh-CN': { title: '通知', message: '此通知暂未提供所选语言版本，请切换语言查看原始内容。' },
  'zh-HK': { title: '通知', message: '此通知暫未提供所選語言版本，請切換語言查看原始內容。' },
};
const fixed = {
  BOOKING_CANCELLED: templates.BOOKING_CANCELLED,
  SERVICE_COMPLETED: templates.SERVICE_COMPLETED,
  BOOKING_NO_SHOW: templates.BOOKING_NO_SHOW,
  PAYMENT_FAILED: templates.PAYMENT_FAILED,
  GROUP_PURCHASE_EXPIRED: templates.GROUP_PURCHASE_EXPIRED,
  REVIEW_REPLY: templates.REVIEW_REPLY,
  STAFF_ACCOUNT_CREATED: templates.STAFF_ACCOUNT_CREATED,
  STAFF_ACTIVATED: templates.STAFF_ACTIVATED,
  STAFF_DEACTIVATED: templates.STAFF_DEACTIVATED,
  STAFF_BRANCH_ASSIGNMENT_UPDATED: templates.STAFF_BRANCH_ASSIGNMENT_UPDATED,
  STAFF_SCHEDULE_UPDATED: templates.STAFF_SCHEDULE_UPDATED,
};

export function notificationEventTitle(type: string, language: Language): string {
  const titles = {
    BOOKING_CONFIRMED: templates.PAY_NOW_CONFIRMED,
    BOOKING_RESERVED: () => templates.BOOKING_RESERVED('', ''),
    BOOKING_RESCHEDULED: () => templates.BOOKING_RESCHEDULED('', ''),
    REFUND_COMPLETED: () => templates.REFUND_COMPLETED(0),
    REVIEW_PUBLISHED: templates.REVIEW_PUBLISHED,
    REVIEW_NEEDS_CHANGES: templates.REVIEW_NEEDS_CHANGES,
    REVIEW_PENDING: templates.REVIEW_PENDING,
  };
  if (type === 'BOOKING_CREATED') return { en: 'New booking', 'zh-CN': '新预约', 'zh-HK': '新預約' }[language];
  if (type === 'BOOKING_EXPIRED') return { en: 'Booking expired', 'zh-CN': '预约已过期', 'zh-HK': '預約已到期' }[language];
  return (titles[type as keyof typeof titles]?.() ?? fixed[type as keyof typeof fixed]?.())?.[language]?.title ?? generic[language].title;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonempty = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;

// Reconstruct only known historical formats. No database backfill, translation
// API, guessed amount/date, or inference of a business operation is involved.
function legacyTranslations(row: StoredNotification): INotificationTranslations | undefined {
  const { type, title, message } = row;
  const team = /^Appointment ([^:]+): (.*), (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2})\.$/.exec(message);
  if (team) return Object.fromEntries((['en', 'zh-CN', 'zh-HK'] as const).map(language => {
    const name = notificationName(undefined, language, team[2], 'service');
    return [language, { title: notificationEventTitle(type, language), message: language === 'en' ? `Appointment ${team[1]}: ${name}, ${team[3]} at ${team[4]}.` : `${language === 'zh-CN' ? '预约' : '預約'} ${team[1]}：${name}，${team[3]} ${team[4]}。` }];
  }));
  if (type === 'BOOKING_CANCELLED' && title === 'Appointment cancelled') return templates.POLICY_BOOKING_CANCELLED(message.includes('awaiting merchant approval'));
  const money = /(?:refund(?: request)? (?:for|of) )([A-Z]{3}) (\d+(?:\.\d{1,2})?)/i.exec(message);
  if (money && Number.isFinite(Number(money[2]))) {
    const amount = Number(money[2]), currency = money[1];
    if (type === 'REFUND_COMPLETED' && message.endsWith(' has been completed.')) return templates.POLICY_REFUND_COMPLETED(amount, currency, message.startsWith('Your group purchase refund'));
    if (type === 'REFUND_COMPLETED' && message === templates.REFUND_COMPLETED(amount, currency).en?.message) return templates.REFUND_COMPLETED(amount, currency);
    if (type === 'SYSTEM' && title === 'Refund Request Approved') return templates.REFUND_REQUEST_APPROVED(amount, currency);
    const rejected = / was rejected\. Reason: ([\s\S]*)$/.exec(message);
    if (type === 'SYSTEM' && title === 'Refund Request Rejected' && rejected) return templates.REFUND_REQUEST_REJECTED(amount, currency, rejected[1]);
  }
  const schedule = / (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2})/.exec(message);
  if (schedule && type === 'BOOKING_RESERVED') return templates.BOOKING_RESERVED(schedule[1], schedule[2]);
  if (schedule && type === 'BOOKING_RESCHEDULED') return templates.BOOKING_RESCHEDULED(schedule[1], schedule[2]);
  if (type === 'BOOKING_CONFIRMED') {
    for (const factory of [templates.BOOKING_CONFIRMED_SUCCESS, templates.PAY_NOW_CONFIRMED, templates.BOOKING_CONFIRMED_RESERVE_NOW, templates.BOOKING_CONFIRMED_DEPOSIT]) {
      const candidate = factory();
      if (candidate.en?.message === message) return candidate;
    }
  }
  if (type === 'REVIEW_PUBLISHED' || type === 'REVIEW_NEEDS_CHANGES' || type === 'REVIEW_PENDING') {
    for (const updated of [false, true]) {
      const candidate = templates[type](updated);
      if (candidate.en?.message === message) return candidate;
    }
  }
  if (type === 'APPOINTMENT_REMINDER') {
    const reminder = /^Reminder: (.*) on (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) \(Hong Kong time\)\.$/.exec(message);
    if (reminder) return templates.APPOINTMENT_REMINDER(reminder[2], reminder[3], reminder[1]);
  }
  // Only recover a recognized variant; an event type alone cannot identify
  // arbitrary historical copy (or additional details written by a merchant).
  const candidate = fixed[type as keyof typeof fixed]?.();
  return candidate?.en?.message === message ? candidate : undefined;
}

export function localizeNotification(row: StoredNotification, language: Language): { title: string; message: string } {
  const translations = record(row.translations);
  const selected = record(translations[language]);
  const english = record(translations.en);
  const recovered = legacyTranslations(row)?.[language];
  const fallback = language === 'en' ? {
    title: /\p{Script=Han}/u.test(row.title) ? recovered?.title ?? generic.en.title : row.title,
    message: /\p{Script=Han}/u.test(row.message) ? recovered?.message ?? generic.en.message : row.message,
  } : {
    title: recovered?.title ?? notificationEventTitle(row.type, language),
    message: recovered?.message ?? generic[language].message,
  };
  const field = (key: 'title' | 'message') => {
    let value = nonempty(selected[key]);
    // Earlier team notifications sometimes stored the English title in all
    // locale slots. Do not treat that duplicate as a Chinese translation.
    if (language !== 'en' && value === (nonempty(english[key]) ?? row[key]) && /[A-Za-z]/.test(value ?? '')) value = undefined;
    const text = value ?? fallback[key];
    return language === 'en' || row.type !== 'APPOINTMENT_REMINDER' ? text : text.replace(/\(Hong Kong time\)/g, language === 'zh-CN' ? '（香港时间）' : '（香港時間）');
  };
  return { title: field('title'), message: field('message') };
}
