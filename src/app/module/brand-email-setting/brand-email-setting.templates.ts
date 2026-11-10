import {
  DEFAULT_LANGUAGE,
  isLanguage,
  type Language,
} from "../../utils/language.js";
import {
  createDateTimeInTimezone,
  getDateInTimezone,
} from "../../utils/brand-timezone.utils.js";

export const EMAIL_EVENTS = [
  "PAY_NOW_CONFIRMED",
  "RESERVE_NOW_RESERVED",
  "DEPOSIT_RECEIVED",
  "GROUP_PURCHASE_SUCCESSFUL",
  "BOOKING_CANCELLED",
  "BOOKING_RESCHEDULED",
  "REFUND_COMPLETED",
] as const;
export type BusinessEmailEvent = (typeof EMAIL_EVENTS)[number];
const englishLabels = {
  bookingNumber: "Booking number",
  branch: "Branch",
  item: "Service / package",
  stylist: "Stylist",
  appointment: "Appointment date and time",
  bookingStatus: "Booking status",
  total: "Total amount",
  depositPercentage: "Deposit percentage",
  depositPaid: "Deposit paid",
  remaining: "Remaining balance",
  paymentStatus: "Payment status",
  quantity: "Quantity purchased",
  paid: "Amount paid",
  unitPrice: "Unit price",
  purchaseDate: "Purchase date",
  validity: "Validity (days)",
  expiry: "Voucher expiry date",
  totalVouchers: "Total vouchers",
  availableVouchers: "Available vouchers",
  allocatedVouchers: "Allocated vouchers",
  usedVouchers: "Used vouchers",
  cancelledAt: "Cancellation date",
  cancellationReason: "Cancellation reason",
  refundAmount: "Refund amount",
  refundStatus: "Refund status",
  refundMethod: "Refund method",
  refundDestination: "Refund destination",
  refundDate: "Refund completion date",
  originalPaid: "Original payment amount",
  walletPaid: "Refund to wallet paid balance",
  walletBonus: "Refund to wallet bonus balance",
  dueAtSalon: "Amount due at salon",
  branchPhone: "Branch phone",
  branchAddress: "Branch address",
  bookingDate: "Booking date",
};
export type EmailLabel = keyof typeof englishLabels;
const labelKeys = Object.keys(englishLabels) as EmailLabel[];
const translatedLabels = (values: string[]) =>
  Object.fromEntries(labelKeys.map((key, i) => [key, values[i]])) as Record<
    EmailLabel,
    string
  >;
const labels = {
  en: englishLabels,
  "zh-CN": translatedLabels([
    "预约编号",
    "分店",
    "服务 / 套餐",
    "发型师",
    "预约日期及时间",
    "预约状态",
    "总额",
    "订金比例",
    "已付订金",
    "待付余额",
    "支付状态",
    "购买数量",
    "已付金额",
    "单价",
    "购买日期",
    "有效期（天）",
    "券到期日期",
    "券总数量",
    "可用券数量",
    "已分配券数量",
    "已使用券数量",
    "取消日期",
    "取消原因",
    "退款金额",
    "退款状态",
    "退款方式",
    "退款去向",
    "退款完成日期",
    "原支付金额",
    "退回钱包本金余额",
    "退回钱包赠金余额",
    "到店待付金额",
    "分店电话",
    "分店地址",
    "预约创建日期",
  ]),
  "zh-HK": translatedLabels([
    "預約編號",
    "分店",
    "服務 / 套餐",
    "髮型師",
    "預約日期及時間",
    "預約狀態",
    "總額",
    "訂金比例",
    "已付訂金",
    "待付餘額",
    "付款狀態",
    "購買數量",
    "已付金額",
    "單價",
    "購買日期",
    "有效期（日）",
    "優惠券到期日期",
    "優惠券總數量",
    "可用優惠券數量",
    "已分配優惠券數量",
    "已使用優惠券數量",
    "取消日期",
    "取消原因",
    "退款金額",
    "退款狀態",
    "退款方式",
    "退款去向",
    "退款完成日期",
    "原付款金額",
    "退回錢包本金餘額",
    "退回錢包贈金餘額",
    "到店待付金額",
    "分店電話",
    "分店地址",
    "預約建立日期",
  ]),
};
const sectionTitles = {
  en: {
    appointment: "Appointment details",
    payment: "Payment summary",
    purchase: "Purchase details",
    vouchers: "Voucher information",
    previous: "Previous appointment",
    updated: "Updated appointment",
    refund: "Refund summary",
  },
  "zh-CN": {
    appointment: "预约详情",
    payment: "支付摘要",
    purchase: "购买详情",
    vouchers: "券信息",
    previous: "原预约",
    updated: "更新后的预约",
    refund: "退款摘要",
  },
  "zh-HK": {
    appointment: "預約詳情",
    payment: "付款摘要",
    purchase: "購買詳情",
    vouchers: "優惠券資料",
    previous: "原預約",
    updated: "更新後的預約",
    refund: "退款摘要",
  },
};
export type EmailDetail = { label: EmailLabel; value: string };
export type EmailSection = {
  title: keyof typeof sectionTitles.en;
  rows: EmailDetail[];
};
export type EmailBrand = {
  name: string;
  email?: string | null;
  phone?: string | null;
  accentColor?: string | null;
};

const copy: Record<
  Language,
  Record<BusinessEmailEvent, readonly [string, string, string, string]>
> = {
  en: {
    PAY_NOW_CONFIRMED: [
      "Your booking is confirmed",
      "Your booking is confirmed!",
      "Your payment was successful and your appointment has been confirmed.",
      "We look forward to welcoming you!",
    ],
    RESERVE_NOW_RESERVED: [
      "Your booking has been reserved",
      "Your booking has been reserved!",
      "Your appointment has been successfully reserved.",
      "Please arrive at the salon at your scheduled appointment time.",
    ],
    DEPOSIT_RECEIVED: [
      "Your deposit has been received",
      "Your deposit has been received!",
      "We have successfully received your deposit and reserved your appointment.",
      "Please settle the remaining balance according to your booking payment arrangements.",
    ],
    GROUP_PURCHASE_SUCCESSFUL: [
      "Your group purchase was successful",
      "Your group purchase was successful!",
      "Thank you for your purchase! Your group purchase has been successfully processed.",
      "Please review your payment status and voucher information before arranging your visit.",
    ],
    BOOKING_CANCELLED: [
      "Your booking has been cancelled",
      "Your booking has been cancelled",
      "Your appointment has been cancelled.",
      "Cancellation and refund completion are separate. Please refer to the refund status below, when applicable.",
    ],
    BOOKING_RESCHEDULED: [
      "Your booking has been rescheduled",
      "Your booking has been rescheduled!",
      "Your appointment has been successfully rescheduled. Please review your updated appointment details.",
      "We look forward to welcoming you at your updated appointment time!",
    ],
    REFUND_COMPLETED: [
      "Your refund has been completed",
      "Your refund has been completed!",
      "Your refund has been successfully processed. The amount shown is for this refund only and may be part of the original payment.",
      "",
    ],
  },
  "zh-CN": {
    PAY_NOW_CONFIRMED: [
      "您的预约已确认",
      "您的预约已确认！",
      "您的支付已成功，预约已确认。",
      "期待您的光临！",
    ],
    RESERVE_NOW_RESERVED: [
      "您的预约已保留",
      "您的预约已保留！",
      "您的预约已成功保留。",
      "请按照预约时间到店。",
    ],
    DEPOSIT_RECEIVED: [
      "您的订金已收到",
      "您的订金已收到！",
      "我们已成功收到您的订金，并为您保留预约。",
      "请根据预约付款安排支付剩余款项。",
    ],
    GROUP_PURCHASE_SUCCESSFUL: [
      "您的团购已成功",
      "您的团购已成功！",
      "感谢您的购买！您的团购已成功处理。",
      "安排到店前，请查看支付状态和券信息。",
    ],
    BOOKING_CANCELLED: [
      "您的预约已取消",
      "您的预约已取消",
      "您的预约已取消。",
      "取消预约与退款完成是不同的事项。如适用，请查看下方退款状态。",
    ],
    BOOKING_RESCHEDULED: [
      "您的预约已改期",
      "您的预约已改期！",
      "您的预约已成功改期，请查看更新后的预约详情。",
      "期待您在新的预约时间光临！",
    ],
    REFUND_COMPLETED: [
      "您的退款已完成",
      "您的退款已完成！",
      "您的退款已成功处理。所列金额仅代表本次退款，可能是原付款的一部分。",
      "Stripe 退款的到账时间由原支付服务商决定。如有钱包入账记录，将显示在下方。",
    ],
  },
  "zh-HK": {
    PAY_NOW_CONFIRMED: [
      "您的預約已確認",
      "您的預約已確認！",
      "您的付款已成功，預約已確認。",
      "期待您的光臨！",
    ],
    RESERVE_NOW_RESERVED: [
      "您的預約已保留",
      "您的預約已保留！",
      "您的預約已成功保留。",
      "請按照預約時間到店。",
    ],
    DEPOSIT_RECEIVED: [
      "您的訂金已收到",
      "您的訂金已收到！",
      "我們已成功收到您的訂金，並為您保留預約。",
      "請根據預約付款安排繳付餘額。",
    ],
    GROUP_PURCHASE_SUCCESSFUL: [
      "您的團購已成功",
      "您的團購已成功！",
      "感謝您的購買！您的團購已成功處理。",
      "安排到店前，請查看付款狀態及優惠券資料。",
    ],
    BOOKING_CANCELLED: [
      "您的預約已取消",
      "您的預約已取消",
      "您的預約已取消。",
      "取消預約與退款完成是不同的事項。如適用，請查看下方退款狀態。",
    ],
    BOOKING_RESCHEDULED: [
      "您的預約已改期",
      "您的預約已改期！",
      "您的預約已成功改期，請查看更新後的預約詳情。",
      "期待您於新的預約時間光臨！",
    ],
    REFUND_COMPLETED: [
      "您的退款已完成",
      "您的退款已完成！",
      "您的退款已成功處理。所列金額只代表本次退款，可能是原付款的一部分。",
      "Stripe 退款的到賬時間由原付款服務商決定。如有錢包入賬紀錄，將顯示於下方。",
    ],
  },
};
const states: Record<string, readonly [string, string, string]> = {
  CONFIRMED: ["Confirmed", "已确认", "已確認"],
  RESERVED: ["Reserved", "已保留", "已保留"],
  CANCELLED: ["Cancelled", "已取消", "已取消"],
  PAID: ["Paid", "已支付", "已付款"],
  UNPAID: ["Unpaid", "未支付", "未付款"],
  PARTIALLY_PAID: ["Partially paid", "部分支付", "部分付款"],
  SUCCEEDED: ["Completed", "已完成", "已完成"],
  COMPLETED: ["Completed", "已完成", "已完成"],
  PENDING: ["Pending", "待处理", "待處理"],
  PENDING_PAYMENT: ["Awaiting payment", "待支付", "待付款"],
  PENDING_APPROVAL: ["Pending approval", "待审批", "待審批"],
  APPROVED: ["Approved", "已批准", "已批准"],
  PROCESSING: ["Processing", "处理中", "處理中"],
  FAILED: ["Failed", "失败", "失敗"],
  REJECTED: ["Rejected", "已拒绝", "已拒絕"],
  REFUNDED: ["Refunded", "已退款", "已退款"],
  PARTIALLY_REFUNDED: ["Partially refunded", "部分退款", "部分退款"],
  EXPIRED: ["Expired", "已过期", "已過期"],
  NO_SHOW: ["No-show", "未到店", "未到店"],
  STRIPE: ["Stripe", "Stripe", "Stripe"],
  WALLET: ["Wallet", "钱包", "錢包"],
  ORIGINAL_PAYMENT: [
    "Original Stripe payment method",
    "原 Stripe 支付方式",
    "原 Stripe 付款方式",
  ],
};
export const escapeEmailHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const emailMoney = (
  amount: unknown,
  currency: string,
  language: string,
) =>
  new Intl.NumberFormat(isLanguage(language) ? language : DEFAULT_LANGUAGE, {
    style: "currency",
    currency,
  }).format(Number(amount));
export function emailInstant(
  date: Date,
  timezone: string,
  language: string = DEFAULT_LANGUAGE,
) {
  return `${new Intl.DateTimeFormat(isLanguage(language) ? language : DEFAULT_LANGUAGE, { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)} (${timezone})`;
}
// The stored date is a calendar key. Resolve its wall-clock time in the actual zone.
export function emailAppointmentTime(
  date: Date,
  start: string,
  end: string,
  timezone = "Asia/Hong_Kong",
) {
  const key = getDateInTimezone("UTC", date);
  const first = createDateTimeInTimezone(key, start, timezone);
  const last =
    end === "24:00"
      ? createDateTimeInTimezone(
          getDateInTimezone("UTC", new Date(date.getTime() + 86400000)),
          "00:00",
          timezone,
        )
      : createDateTimeInTimezone(key, end, timezone);
  const time = (value: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(value);
  return `${getDateInTimezone(timezone, first)} ${time(first)}–${time(last)} (${timezone})`;
}
const publicText = (value: string) =>
  value
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "",
    )
    .replace(/\b(?:pi|re|cs)_[A-Za-z0-9_]+\b/g, "")
    .trim();
export function renderBusinessEmail(
  event: BusinessEmailEvent,
  language: string,
  customerName: string,
  sections: EmailSection[],
  brand: EmailBrand,
) {
  const lang = isLanguage(language) ? language : DEFAULT_LANGUAGE;
  const index = lang === "en" ? 0 : lang === "zh-CN" ? 1 : 2;
  const name = publicText(brand.name).replace(/[\r\n]/g, " ");
  if (!name) throw new Error("EMAIL_BRAND_NAME_REQUIRED");
  const [subjectTitle, heading, description, closing] = copy[lang][event];
  const greeting =
    lang === "en"
      ? `Hello ${publicText(customerName)},`
      : `${publicText(customerName)}，您好：`;
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accentColor ?? "")
    ? brand.accentColor!
    : "#716044";
  const contacts = [brand.email, brand.phone]
    .filter((v): v is string => !!v?.trim())
    .map(publicText);
  const stateLabels: EmailLabel[] = [
    "bookingStatus",
    "paymentStatus",
    "refundStatus",
    "refundMethod",
    "refundDestination",
  ];
  const content = sections
    .map((section) => ({
      title: sectionTitles[lang][section.title],
      rows: section.rows
        .map((row) => ({
          label: labels[lang][row.label],
          value: publicText(
            (stateLabels.includes(row.label)
              ? states[row.value]?.[index]
              : undefined) ?? row.value,
          ),
        }))
        .filter(
          (row) =>
            row.value && row.value !== "undefined" && row.value !== "null",
        ),
    }))
    .filter((section) => section.rows.length);
  const subject = `${name} · ${subjectTitle}`;
  const text = [
    name,
    heading,
    greeting,
    description,
    ...content.map(
      (section) =>
        `${section.title}\n${section.rows.map((row) => `${row.label}: ${row.value}`).join("\n")}`,
    ),
    closing,
    name,
    ...contacts,
  ].join("\n\n");
  const esc = escapeEmailHtml;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#202532"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #e6e8ec;border-radius:12px"><tr><td style="padding:28px"><p style="color:${accent};font-size:18px;font-weight:bold">${esc(name)}</p><h1 style="font-size:25px;line-height:1.3">${esc(heading)}</h1><p>${esc(greeting)}</p><p style="line-height:1.6">${esc(description)}</p>${content.map((section) => `<h2 style="font-size:17px;margin-top:28px;color:${accent}">${esc(section.title)}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed;overflow-wrap:anywhere">${section.rows.map((row) => `<tr><td style="padding:11px 6px;border-bottom:1px solid #eee;width:42%;vertical-align:top;color:#596171;word-break:break-word">${esc(row.label)}</td><td style="padding:11px 6px;border-bottom:1px solid #eee;vertical-align:top;word-break:break-word">${esc(row.value)}</td></tr>`).join("")}</table>`).join("")}<p style="margin-top:28px;line-height:1.6">${esc(closing)}</p><p style="color:${accent};font-weight:bold">${esc(name)}</p>${contacts.map((contact) => `<p style="font-size:12px;color:#596171;overflow-wrap:anywhere">${esc(contact)}</p>`).join("")}</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
