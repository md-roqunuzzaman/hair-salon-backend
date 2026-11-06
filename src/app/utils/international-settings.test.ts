import assert from "node:assert/strict";
import test from "node:test";
import { createDateTimeInTimezone, getDateInTimezone, assertTimezoneDuration, localDateBoundary } from "./brand-timezone.utils.js";
import { stripeAmount, assertCurrencyAmount, assertSameCurrency, historicalPurchaseCurrency } from "./transaction-currency.utils.js";
import { validateCurrencyCode } from "./international-config.utils.js";
import { appointmentTimezone } from "./appointment-timezone.utils.js";
import { notificationTemplates } from "../module/notification/notification.templates.js";
import { emailAppointmentTime } from "../module/brand-email-setting/brand-email-setting.templates.js";

for (const [zone, currency, instant, date, time, wire] of [
  ["Asia/Hong_Kong", "HKD", "2026-11-06T02:30:00.000Z", "2026-11-06", "10:30", 10025],
  ["Europe/London", "GBP", "2026-07-06T09:30:00.000Z", "2026-07-06", "10:30", 10025],
  ["America/New_York", "USD", "2026-11-06T15:30:00.000Z", "2026-11-06", "10:30", 10025],
  ["Asia/Tokyo", "JPY", "2026-11-06T01:30:00.000Z", "2026-11-06", "10:30", 100],
] as const) {
  test(`${zone}/${currency}: calendar key, instant and Stripe units`, () => {
    assert.equal(createDateTimeInTimezone(date, time, zone).toISOString(), instant);
    assert.equal(getDateInTimezone(zone, new Date(instant)), date);
    assert.equal(stripeAmount(currency === "JPY" ? "100" : "100.25", currency), wire);
    assertTimezoneDuration(date, "10:30", "11:30", 60, zone);
    assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
  });
}
for (const [zone, date, time] of [
  ["Europe/London", "2026-03-29", "01:30"],
  ["America/New_York", "2026-03-08", "02:30"],
] as const) test(`${zone} rejects nonexistent local time`, () => assert.throws(() => createDateTimeInTimezone(date, time, zone), /does not exist/));
for (const [zone, date, time] of [
  ["Europe/London", "2026-10-25", "01:30"],
  ["America/New_York", "2026-11-01", "01:30"],
  ["Australia/Lord_Howe", "2026-04-05", "01:45"],
] as const) test(`${zone} rejects ambiguous local time`, () => assert.throws(() => createDateTimeInTimezone(date, time, zone), /ambiguous/));
test("duration across a DST transition cannot silently shorten a service", () => {
  assert.throws(() => assertTimezoneDuration("2026-03-29", "00:30", "02:30", 120, "Europe/London"), /transition/);
});
test("London and New York instant filter boundaries follow 23/25 hour days", () => {
  for (const [zone, date, hours] of [["Europe/London", "2026-03-29", 23], ["America/New_York", "2026-11-01", 25]] as const) {
    assert.equal(localDateBoundary(date, zone, true).getTime() + 1 - localDateBoundary(date, zone).getTime(), hours * 3600000);
  }
});
test("New York local yesterday and Tokyo local tomorrow differ from UTC calendar", () => {
  const instant = new Date("2026-11-06T01:00:00Z");
  assert.equal(getDateInTimezone("America/New_York", instant), "2026-11-05");
  assert.equal(getDateInTimezone("Asia/Tokyo", new Date("2026-11-06T23:00:00Z")), "2026-11-07");
});
test("invalid date/time cannot normalize into another booking", () => {
  for (const [date,time] of [["2026-02-30","10:00"],["2026-11-06","24:00"],["2026-11-06","10:60"]]) assert.throws(() => createDateTimeInTimezone(date!, time!, "Asia/Tokyo"), /Invalid/);
});
test("JPY fractions and unsupported precision are rejected without rounding", () => {
  assert.throws(() => stripeAmount("100.25", "JPY"), /represented/);
  assert.throws(() => assertCurrencyAmount("1.001", "GBP"), /represented/);
  assert.throws(() => validateCurrencyCode("KWD"), /precision/);
  assert.throws(() => validateCurrencyCode("XYZ"), /Invalid ISO/);
  assert.equal(stripeAmount("10", "ISK"), 1000);
  assert.equal(stripeAmount("10", "UGX"), 1000);
  assert.throws(() => stripeAmount("10", "ugx"), /reconciliation/);
});
test("historical purchase denomination must be evidenced and consistent", () => {
  assert.equal(historicalPurchaseCurrency(null, ["HKD", "HKD"]), "HKD");
  assert.equal(historicalPurchaseCurrency("HKD", []), "HKD");
  assert.throws(() => historicalPurchaseCurrency(null, []), /reconciliation/);
  assert.throws(() => historicalPurchaseCurrency("GBP", ["HKD"]), /reconciliation/);
  assert.throws(() => assertSameCurrency("HKD", "GBP"), /mismatch/);
});
test("snapshot timezone wins over current Brand timezone without reinterpretation", async () => {
  const client = { appointment: { findUnique: async () => ({ timezone: "Asia/Hong_Kong" }) }, brand: { findFirst: async () => { throw new Error("Must not read current Brand for a snapshot"); } } };
  assert.equal(await appointmentTimezone(client as never, "synthetic"), "Asia/Hong_Kong");
});
test("notification and email labels use original timezone and currency digits in every locale", () => {
  const translations = notificationTemplates.APPOINTMENT_REMINDER("2026-11-06", "10:00", "Haircut", undefined, "Europe/London");
  for (const language of ["en", "zh-CN", "zh-HK"] as const) {
    assert.match(translations[language]!.message!, /Europe\/London/);
    assert.doesNotMatch(translations[language]!.message!, /Hong Kong|香港/);
    const money = notificationTemplates.REMAINING_PAYMENT_RECEIVED(100, "JPY")[language]!.message!;
    assert.match(money, /JPY 100/); assert.doesNotMatch(money, /100\.00/);
  }
  assert.match(emailAppointmentTime(new Date("2026-11-06"), "10:00", "11:00", "America/New_York"), /America\/New_York/);
});
