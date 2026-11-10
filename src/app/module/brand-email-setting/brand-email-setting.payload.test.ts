import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { enqueueAppointmentEmail, enqueueGroupPurchaseEmail, enqueueRefundEmail } from "./brand-email-setting.payload.js";
import { EMAIL_EVENTS, emailAppointmentTime, emailInstant, renderBusinessEmail, type EmailSection } from "./brand-email-setting.templates.js";

// All storage is in-memory. Provider configuration reads are intercepted before
// calling any builder; these tests cannot connect to a database or send email.
const originalBrandRead = prisma.brand.findMany;
const originalSettingRead = prisma.brandEmailSetting.findUnique;
before(() => {
  // Prisma delegates use dynamic properties; assign and restore explicitly.
  prisma.brand.findMany = (async () => [{ id: "brand" }]) as any;
  prisma.brandEmailSetting.findUnique = (async () => null) as any;
});
after(() => {
  prisma.brand.findMany = originalBrandRead;
  prisma.brandEmailSetting.findUnique = originalSettingRead;
});
const decimal = (value: number | string) => new Prisma.Decimal(value);
const internalId = "11111111-2222-4333-8444-555555555555";
const noIds = (job: any) => assert.doesNotMatch(job.html + job.text + job.subject, /[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|pi_secret|re_secret/);

function fixture(lang = "en") {
  const customer = { id: "customer", name: '<Customer & "Guest">', email: "sample@example.com", preferredLanguage: lang };
  const brand = { id: "brand", name: "KIN1 Hair", translations: { "zh-CN": { name: "示例美发" }, "zh-HK": { name: "示例髮型" } }, primaryColor: "#716044", phone: "+852 0000 0000", email: "support@example.com", timezone: "Asia/Hong_Kong" };
  const branch = { name: "Sample Central", translations: { "zh-CN": { name: "示例中环店" }, "zh-HK": { name: "示例中環店" } }, phone: "+852 0000 0001", address: "Sample address" };
  const payment = { id: "payment", customerId: customer.id, groupPurchaseId: internalId, purpose: "GROUP_PURCHASE", provider: "STRIPE", amount: decimal(1000), currency: "HKD", status: "PAID", paidAt: new Date("2026-11-09T02:00:00Z") };
  const appointment: any = { id: internalId, orderNumber: "QQ5SC9", customerId: customer.id, customer, branch, staff: { name: "New Stylist" }, groupPurchaseId: null, groupPurchase: null, itemName: "Snapshot Cut", itemNameTranslations: { "zh-CN": { name: "快照剪发" }, "zh-HK": { name: "快照剪髮" } }, date: new Date("2026-11-10"), startTime: "10:00", endTime: "11:00", staffId: "new-staff", timezone: "America/New_York", emailScheduleRevision: 1, bookingMethod: "PAY_NOW", appointmentStatus: "CONFIRMED", paymentStatus: "PAID", price: decimal(1000), currency: "HKD", depositPercentage: decimal(10), depositAmount: decimal(100), remainingAmount: decimal(900), payments: [{ ...payment, purpose: "APPOINTMENT", groupPurchaseId: null }], cancelledAt: new Date("2026-11-09T02:00:00Z"), cancellationReason: `Changed plans ${internalId}` };
  const purchase: any = { id: internalId, customer, customerId: customer.id, package: { name: "Sample Package", translations: { "zh-CN": { name: "示例套餐" }, "zh-HK": { name: "示例套餐" } } }, settledPayment: payment, payments: [payment], purchaseFlow: "BUY_NOW_BOOK_LATER", bookingMethod: null, quantity: 2, unitPrice: decimal(500), amount: decimal(1000), currency: "HKD", paymentStatus: "PAID", remainingAmount: null, validDaysSnapshot: 30, purchasedAt: new Date("2026-11-09T02:00:00Z"), appointments: [], forfeitedQuantity: 0, refundedQuantity: 0, purchaseBranch: branch };
  const refund: any = { id: internalId, status: "SUCCEEDED", amount: decimal("176.40"), refundedAt: new Date("2026-11-09T05:53:09Z"), payment: { ...payment, customer, appointment: null, groupPurchase: purchase } };
  const jobs = new Map<string, any>();
  const state: any = { credits: [], requests: [] };
  const tx = {
    brand: { findMany: async () => [brand] },
    appointment: { findUnique: async () => appointment },
    staff: { findMany: async () => [{ id: "old-staff", name: "Previous Stylist" }, { id: "new-staff", name: "New Stylist" }] },
    groupPurchase: { findUnique: async () => purchase }, payment: { findFirst: async () => payment },
    refund: { findUnique: async () => refund }, walletTransaction: { findMany: async (query: any) => {
      state.creditReads = (state.creditReads ?? 0) + 1; state.creditQuery = query;
      return state.credits.map((credit: any) => ({paymentId: payment.id, wallet: {customerId: customer.id, currency: payment.currency}, ...credit}));
    } }, refundRequest: { findMany: async () => state.requests },
    emailOutbox: { findUnique: async ({ where }: any) => jobs.get(where.idempotencyKey), upsert: async ({ create }: any) => { if (!jobs.has(create.idempotencyKey)) jobs.set(create.idempotencyKey, { id: "job", ...create }); return jobs.get(create.idempotencyKey); } },
    emailOutboxHistory: { upsert: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  return { tx, appointment, purchase, payment, refund, state, jobs, brand };
}
for (const lang of ["en", "zh-CN", "zh-HK"]) for (const event of EMAIL_EVENTS) {
  test(`${lang}: ${event} builds branded, escaped, identifier-free HTML and text`, async () => {
    const f = fixture(lang);
    let job: any;
    if (event === "GROUP_PURCHASE_SUCCESSFUL") job = await enqueueGroupPurchaseEmail(f.tx, internalId);
    else if (event === "REFUND_COMPLETED") job = await enqueueRefundEmail(f.tx, internalId);
    else {
      if (event === "BOOKING_CANCELLED") f.appointment.appointmentStatus = "CANCELLED";
      if (event === "RESERVE_NOW_RESERVED") { f.appointment.bookingMethod = "RESERVE_NOW"; f.appointment.paymentStatus = "UNPAID"; f.appointment.appointmentStatus = "RESERVED"; f.appointment.payments = []; f.appointment.remainingAmount = null; }
      if (event === "DEPOSIT_RECEIVED") { f.appointment.bookingMethod = "DEPOSIT"; f.appointment.paymentStatus = "PARTIALLY_PAID"; f.appointment.appointmentStatus = "RESERVED"; f.appointment.payments = [{ ...f.payment, purpose: "APPOINTMENT_DEPOSIT", amount: decimal(100) }]; }
      job = await enqueueAppointmentEmail(f.tx, internalId, event, { date: new Date("2026-11-10"), startTime: "08:00", endTime: "09:00", staffId: "old-staff" }, internalId, { date: "2026-11-10T00:00:00.000Z", startTime: "10:00", endTime: "11:00", staffId: "new-staff", revision: 1 });
    }
    assert.ok(job);
    const name = lang === "en" ? "KIN1 Hair" : lang === "zh-CN" ? "示例美发" : "示例髮型";
    assert.ok(job.subject.startsWith(`${name} · `));
    assert.ok(job.html.split(name).length >= 3);
    assert.ok(job.text.startsWith(name));
    assert.ok(job.text.includes("support@example.com"));
    assert.ok(job.html.includes(`lang="${lang}"`));
    assert.ok(job.html.includes("&lt;Customer &amp; &quot;Guest&quot;&gt;"));
    assert.doesNotMatch(job.html, /<Customer|undefined|ABC Hair Salon/);
    noIds(job);
    if (event === "REFUND_COMPLETED") assert.ok(job.text.includes("176.40"));
    if (event === "BOOKING_RESCHEDULED") { assert.match(job.text, /08:00–09:00/); assert.match(job.text, /10:00–11:00/); assert.match(job.text, /Previous Stylist/); assert.match(job.text, /New Stylist/); }
    if (event === "DEPOSIT_RECEIVED") { assert.match(job.text, /100.00/); assert.match(job.text, /900.00/); }
    if (event !== "GROUP_PURCHASE_SUCCESSFUL" && event !== "REFUND_COMPLETED") assert.match(job.text, /QQ5SC9/);
  });
}
test("new branding changes only new queued snapshots; stable keys never replace existing content", async () => {
  const f = fixture(); const first: any = await enqueueGroupPurchaseEmail(f.tx, internalId);
  const original = first.html;
  f.brand.name = "Updated Salon";
  assert.equal((await enqueueGroupPurchaseEmail(f.tx, internalId))!.html, original);
  f.payment.groupPurchaseId = "second";
  f.purchase.id = "second";
  assert.match((await enqueueGroupPurchaseEmail(f.tx, "second"))!.subject, /^Updated Salon/);
});
test("direct-book group deposit uses full purchase snapshots and actual voucher allocation", async () => {
  const f = fixture(); f.purchase.purchaseFlow = "DIRECT_BOOK"; f.purchase.bookingMethod = "DEPOSIT";
  f.purchase.paymentStatus = "PARTIALLY_PAID"; f.purchase.remainingAmount = decimal(900);
  f.payment.amount = decimal(100); f.appointment.bookingMethod = "DEPOSIT"; f.appointment.appointmentStatus = "RESERVED";
  f.purchase.appointments = [f.appointment];
  const job = await enqueueGroupPurchaseEmail(f.tx, internalId);
  assert.match(job!.text!, /Total amount:.*1,000.00/);
  assert.match(job!.text!, /Amount paid:.*100.00/);
  assert.match(job!.text!, /Remaining balance:.*900.00/);
  assert.match(job!.text!, /Payment status: Partially paid/);
  assert.match(job!.text!, /Available vouchers: 1/);
  assert.match(job!.text!, /Used vouchers: 0/);
  assert.match(job!.text!, /Snapshot Cut/);
  noIds(job);
});
for (const status of ["PENDING", "APPROVED", "PROCESSING", "FAILED"]) test(`cancellation with ${status} refund never claims completion`, async () => {
  const f = fixture(); f.appointment.appointmentStatus = "CANCELLED";
  f.state.requests = [{ amount: decimal(100), status, refund: null }];
  const job = await enqueueAppointmentEmail(f.tx, internalId, "BOOKING_CANCELLED");
  assert.match(job!.text!, /Refund amount:/);
  assert.doesNotMatch(job!.text!, /Refund status: Completed/);
  noIds(job);
});
test("cancellation without refund omits refund summary", async () => {
  const f = fixture(); f.appointment.appointmentStatus = "CANCELLED";
  const job = await enqueueAppointmentEmail(f.tx, internalId, "BOOKING_CANCELLED");
  assert.doesNotMatch(job!.text!, /Refund summary/);
});
for (const split of [[100, 0], [0, 100], [60, 40]]) test(`wallet refund preserves actual paid/bonus split ${split}`, async () => {
  const f = fixture(); f.refund.payment.provider = "WALLET"; f.refund.amount = decimal(100);
  f.state.credits = split.map((amount, i) => ({ balanceType: i ? "BONUS" : "PAID", amount: decimal(amount) })).filter(row => row.amount.gt(0));
  const job = await enqueueRefundEmail(f.tx, internalId);
  assert.match(job!.text!, /Refund method: Wallet/);
  assert.doesNotMatch(job!.text!, /Original Stripe payment method/);
  if (split[0]) assert.match(job!.text!, /Refund to wallet paid balance:/);
  if (split[1]) assert.match(job!.text!, /Refund to wallet bonus balance:/);
  noIds(job);
});
test("missing or inconsistent refund credit evidence never invents destination amounts", async () => {
  const f = fixture(); f.refund.payment.provider = "WALLET";
  await assert.rejects(enqueueRefundEmail(f.tx, internalId), /EMAIL_REFUND_LEDGER_RECONCILIATION_REQUIRED/);
  f.refund.status = "PENDING";
  assert.equal(await enqueueRefundEmail(f.tx, internalId), null);
});
for (const status of ["SENT", "SKIPPED", "FAILED", "DELIVERY_UNCERTAIN", "PENDING", "PROCESSING", "SENDING"]) {
  test(`existing ${status} refund job is reused without historical ledger reconstruction`, async () => {
    const f = fixture(); f.refund.payment.provider = "WALLET";
    const key = `merchant-v1:brand:REFUND_COMPLETED:${internalId}`;
    const queued = {id:"historical-job",idempotencyKey:key,status,subject:"Original subject",html:"Original HTML",text:"Original text",attempts:2};
    f.jobs.set(key, queued);
    assert.equal(await enqueueRefundEmail(f.tx, internalId), queued);
    assert.equal(f.state.creditReads, undefined);
    assert.equal(f.jobs.size, 1);
    assert.equal(queued.attempts, 2);
    // A later Stripe refund in the same reconciliation pass must still enqueue.
    f.refund.id = "new-stripe-refund"; f.refund.payment.provider = "STRIPE";
    const next = await enqueueRefundEmail(f.tx, f.refund.id);
    assert.ok(next); assert.equal(f.jobs.size, 2);
    assert.equal(queued.status, status); assert.equal(queued.html, "Original HTML");
  });
}
test("legacy wallet credits with NULL paymentId resolve only through the exact refund reference and owning currency", async () => {
  const f = fixture(); f.refund.payment.provider = "WALLET"; f.refund.amount = decimal(121);
  f.state.credits = [{paymentId:null,balanceType:"PAID",amount:decimal(121)}];
  const job = await enqueueRefundEmail(f.tx, internalId);
  assert.match(job!.text!, /Refund to wallet paid balance:.*121.00/);
  assert.deepEqual(f.state.creditQuery.where, {referenceId:internalId,type:"REFUND"});
  noIds(job);
});
for (const conflict of ["payment", "customer", "currency", "amount", "negative", "balanceType"]) {
  test(`legacy credit ${conflict} conflict remains rejected`, async () => {
    const f = fixture(); f.refund.payment.provider = "WALLET"; f.refund.amount = decimal(100);
    const credit: any = {paymentId:null,balanceType:"PAID",amount:decimal(100),wallet:{customerId:"customer",currency:"HKD"}};
    if (conflict === "payment") credit.paymentId = "different-payment";
    if (conflict === "customer") credit.wallet.customerId = "different-customer";
    if (conflict === "currency") credit.wallet.currency = "USD";
    if (conflict === "amount") credit.amount = decimal(99);
    if (conflict === "negative") credit.amount = decimal(-100);
    if (conflict === "balanceType") credit.balanceType = "OTHER";
    f.state.credits = [credit];
    await assert.rejects(enqueueRefundEmail(f.tx, internalId), /EMAIL_REFUND_LEDGER_RECONCILIATION_REQUIRED/);
    assert.equal(f.jobs.size, 0);
  });
}
test("missing optional values, unsafe color and unsupported language are handled safely", () => {
  const sections: EmailSection[] = [{ title: "refund", rows: [{ label: "refundDestination", value: internalId }, { label: "refundAmount", value: "HK$50.00" }] }];
  const job = renderBusinessEmail("REFUND_COMPLETED", "zh-TW", "Sample", sections, { name: "Sample & Salon", accentColor: 'red; background:url(secret)' });
  assert.match(job.html, /lang="en"/); assert.match(job.html, /#716044/);
  assert.doesNotMatch(job.html, /url\(secret\)|Refund destination|undefined|null/);
  assert.match(job.html, /Sample &amp; Salon/); noIds(job);
});
test("timezone conversion distinguishes real instants from appointment calendar keys", () => {
  assert.match(emailInstant(new Date("2026-11-09T00:30:00Z"), "America/New_York"), /11\/08\/2026/);
  assert.equal(emailAppointmentTime(new Date("2026-11-09"), "00:30", "01:00", "America/New_York"), "2026-11-09 00:30–01:00 (America/New_York)");
  assert.throws(() => emailAppointmentTime(new Date("2026-03-08"), "02:30", "03:30", "America/New_York"), /does not exist/);
});
test("item names that resemble status codes are preserved, while real statuses are localized", () => {
  const job = renderBusinessEmail("PAY_NOW_CONFIRMED", "zh-HK", "Sample", [{title:"appointment",rows:[{label:"item",value:"CONFIRMED"},{label:"bookingStatus",value:"CONFIRMED"}]}], {name:"KIN1 Hair"});
  assert.match(job.text, /服務 \/ 套餐: CONFIRMED/);
  assert.match(job.text, /預約狀態: 已確認/);
});
test("cancellation never equates one successful allocation to a still-processing refund request", async () => {
  const f = fixture(); f.appointment.appointmentStatus = "CANCELLED";
  f.state.requests = [{amount:decimal(100),status:"PROCESSING",refund:{status:"SUCCEEDED"}}];
  const job = await enqueueAppointmentEmail(f.tx, internalId, "BOOKING_CANCELLED");
  assert.match(job!.text!, /Refund status: Processing/);
});
test("direct-book full purchase and missing optional voucher validity keep actual paid state", async () => {
  const f = fixture(); f.purchase.purchaseFlow = "DIRECT_BOOK"; f.purchase.bookingMethod = "PAY_NOW"; f.purchase.appointments = [f.appointment]; f.purchase.validDaysSnapshot = null;
  const job = await enqueueGroupPurchaseEmail(f.tx, internalId);
  assert.match(job!.text!, /Payment status: Paid/);
  assert.doesNotMatch(job!.text!, /Voucher expiry date|Validity \(days\)|Remaining balance/);
});
