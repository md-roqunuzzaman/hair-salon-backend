// Synthetic presentation data only. No database, provider, secrets or delivery.
// Run: node --import tsx scripts/preview-transactional-emails.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { EMAIL_EVENTS, renderBusinessEmail, emailMoney } from '../src/app/module/brand-email-setting/brand-email-setting.templates.ts';

const directory = 'docs/email-previews';
await mkdir(directory, { recursive: true });
const links = [];
for (const language of ['en', 'zh-CN', 'zh-HK']) {
  const money = value => emailMoney(value, 'HKD', language);
  const row = (label, value) => ({ label, value });
  const item = language === 'en' ? 'Sample haircut package' : language === 'zh-CN' ? '示例剪发套餐' : '示例剪髮套餐';
  const branch = language === 'en' ? 'Sample Central Branch' : language === 'zh-CN' ? '示例中环分店' : '示例中環分店';
  const common = [row('item', item), row('branch', branch), row('bookingNumber', 'QQ5SC9')];
  for (const event of EMAIL_EVENTS) {
    let sections = [{ title: 'appointment', rows: [...common, row('stylist', 'Sample Stylist'), row('appointment', '2026-11-10 10:00–11:00 (Asia/Hong_Kong)'), row('bookingStatus', 'CONFIRMED')] }];
    if (event === 'PAY_NOW_CONFIRMED') sections.push({ title: 'payment', rows: [row('total', money(1000)), row('paid', money(1000)), row('paymentStatus', 'PAID')] });
    if (event === 'RESERVE_NOW_RESERVED') {
      sections[0].rows.at(-1).value = 'RESERVED';
      sections.push({ title: 'payment', rows: [row('total', money(1000)), row('paid', money(0)), row('dueAtSalon', money(1000)), row('paymentStatus', 'UNPAID')] });
    }
    if (event === 'DEPOSIT_RECEIVED') {
      sections[0].rows.at(-1).value = 'RESERVED';
      sections.push({ title: 'payment', rows: [row('total', money(1000)), row('depositPercentage', '10%'), row('depositPaid', money(100)), row('remaining', money(900)), row('paymentStatus', 'PARTIALLY_PAID')] });
    }
    if (event === 'GROUP_PURCHASE_SUCCESSFUL') sections = [
      { title: 'purchase', rows: [row('item', item), row('purchaseDate', '2026-11-09 10:00 (Asia/Hong_Kong)'), row('quantity', '2'), row('unitPrice', money(500)), row('total', money(1000)), row('paid', money(100)), row('remaining', money(900)), row('paymentStatus', 'PARTIALLY_PAID')] },
      { title: 'vouchers', rows: [row('totalVouchers', '2'), row('availableVouchers', '1'), row('allocatedVouchers', '1'), row('usedVouchers', '0'), row('validity', '30'), row('expiry', '2026-12-09 10:00 (Asia/Hong_Kong)')] },
      { title: 'appointment', rows: [...common, row('appointment', '2026-11-10 10:00–11:00 (Asia/Hong_Kong)'), row('stylist', 'Sample Stylist'), row('bookingStatus', 'RESERVED')] },
    ];
    if (event === 'BOOKING_CANCELLED') {
      sections[0].rows.at(-1).value = 'CANCELLED';
      sections.push({ title: 'refund', rows: [row('refundAmount', money(100)), row('refundStatus', 'PENDING')] });
    }
    if (event === 'BOOKING_RESCHEDULED') sections = [
      { title: 'appointment', rows: common },
      { title: 'previous', rows: [row('appointment', '2026-11-10 09:00–10:00 (Asia/Hong_Kong)'), row('stylist', 'Sample Previous Stylist')] },
      { title: 'updated', rows: [row('appointment', '2026-11-10 11:00–12:00 (Asia/Hong_Kong)'), row('stylist', 'Sample New Stylist'), row('bookingStatus', 'RESERVED')] },
    ];
    if (event === 'REFUND_COMPLETED') sections = [
      { title: 'purchase', rows: [row('item', item), row('branch', branch)] },
      { title: 'refund', rows: [row('originalPaid', money(1000)), row('refundAmount', money(176.4)), row('refundMethod', 'WALLET'), row('walletPaid', money(120)), row('walletBonus', money(56.4)), row('refundDate', '2026-11-09 13:53 (Asia/Hong_Kong)'), row('refundStatus', 'SUCCEEDED')] },
    ];
    const output = renderBusinessEmail(event, language, 'SAMPLE Customer', sections, { name: language === 'en' ? 'SAMPLE · KIN1 Hair' : '示例 · KIN1 Hair', email: 'sample-support@example.com', accentColor: '#716044' });
    const name = `${event}.${language}`;
    await writeFile(`${directory}/${name}.html`, output.html);
    await writeFile(`${directory}/${name}.txt`, `SYNTHETIC PREVIEW — NOT A REAL TRANSACTION\nSubject: ${output.subject}\n\n${output.text}\n`);
    links.push(`<li>${event} · ${language}: <a href="${name}.html">HTML</a> / <a href="${name}.txt">Plain text</a></li>`);
  }
}
await writeFile(`${directory}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic email previews</title><body><h1>Synthetic email previews</h1><p>Sample data only. No emails sent. These are template previews, not delivery or inbox screenshots.</p><ul>${links.join('')}</ul></body></html>`);
console.log('Generated 21 synthetic HTML and plain-text email previews.');
