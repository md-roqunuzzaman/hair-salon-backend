import { DEFAULT_LANGUAGE, isLanguage } from '../../utils/language.js';

export const EMAIL_EVENTS = ['PAY_NOW_CONFIRMED','RESERVE_NOW_RESERVED','DEPOSIT_RECEIVED','GROUP_PURCHASE_SUCCESSFUL','BOOKING_CANCELLED','BOOKING_RESCHEDULED','REFUND_COMPLETED'] as const;
export type BusinessEmailEvent = typeof EMAIL_EVENTS[number];
const titles = {
  en: ['Booking confirmed','Booking reserved','Deposit received','Group purchase successful','Booking cancelled','Booking rescheduled','Refund completed'],
  'zh-CN': ['预约已确认','预约已保留','订金支付成功','团购成功','预约已取消','预约已改期','退款已完成'],
  'zh-HK': ['預約已確認','預約已保留','訂金支付成功','團購成功','預約已取消','預約已改期','退款已完成'],
};
const labels = {
  en: ['Reference','Branch','Service / package','Staff','Appointment (Hong Kong time)','Status','Total','Deposit paid','Remaining balance','Payment status','Previous appointment (Hong Kong time)','Quantity','Paid amount','Validity (days)','Refund amount','Refund reference'],
  'zh-CN': ['编号','分店','服务 / 套餐','员工','预约时间（香港时间）','状态','总额','已付订金','待付余额','支付状态','原预约时间（香港时间）','数量','已付金额','有效期（天）','退款金额','退款编号'],
  'zh-HK': ['編號','分店','服務 / 套餐','員工','預約時間（香港時間）','狀態','總額','已付訂金','待付餘額','付款狀態','原預約時間（香港時間）','數量','已付金額','有效期（天）','退款金額','退款編號'],
};
const states: Record<string, [string,string,string]> = {
  CONFIRMED: ['Confirmed','已确认','已確認'], RESERVED: ['Reserved','已保留','已保留'], CANCELLED: ['Cancelled','已取消','已取消'],
  PAID: ['Paid','已支付','已付款'], UNPAID: ['Unpaid','未支付','未付款'], PARTIALLY_PAID: ['Partially paid','部分支付','部分付款'],
  SUCCEEDED: ['Succeeded','成功','成功'],
  PENDING: ['Pending','待支付','待付款'], FAILED: ['Failed','失败','失敗'],
  REFUNDED: ['Refunded','已退款','已退款'], PARTIALLY_REFUNDED: ['Partially refunded','部分退款','部分退款'],
};
export const escapeEmailHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const emailMoney = (amount: unknown, currency: string, language: string) => new Intl.NumberFormat(isLanguage(language) ? language : DEFAULT_LANGUAGE, { style: 'currency', currency }).format(Number(amount));
export const emailAppointmentTime = (date: Date, start: string, end: string) => `${date.toISOString().slice(0,10)} ${start}–${end} (Asia/Hong_Kong)`;
export type EmailDetail = [number, string];
export function renderBusinessEmail(event: BusinessEmailEvent, language: string, customerName: string, details: EmailDetail[]) {
  const lang = isLanguage(language) ? language : DEFAULT_LANGUAGE;
  const index = lang === 'en' ? 0 : lang === 'zh-CN' ? 1 : 2;
  const title = titles[lang][EMAIL_EVENTS.indexOf(event)];
  const greeting = lang === 'en' ? `Hello ${customerName},` : `${customerName}，您好：`;
  const lines = details.map(([label,value]) => [labels[lang][label], states[value]?.[index] ?? value]);
  const subject = `ABC Hair Salon · ${title}`;
  const text = `${greeting}\n\n${title}\n\n${lines.map(([k,v])=>`${k}: ${v}`).join('\n')}\n\nABC Hair Salon`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#202532"><table role="presentation" width="100%"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:600px;margin:auto;background:#fff;border-radius:12px"><tr><td style="padding:28px"><p style="color:#716044;font-weight:bold">ABC HAIR SALON</p><h1 style="font-size:24px">${escapeEmailHtml(title)}</h1><p>${escapeEmailHtml(greeting)}</p><table role="presentation" width="100%" style="border-collapse:collapse;overflow-wrap:anywhere">${lines.map(([k,v])=>`<tr><td style="padding:12px 8px;border-bottom:1px solid #eee;width:42%;vertical-align:top;color:#596171">${escapeEmailHtml(k)}</td><td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top">${escapeEmailHtml(v)}</td></tr>`).join('')}</table><p style="margin-top:28px;color:#716044">ABC Hair Salon</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
