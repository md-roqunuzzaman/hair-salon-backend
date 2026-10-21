import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { payBooking, refundBooking } from './financial-flow.mjs';

const now = 1_800_000_000_000;

async function setup(t) {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("financial proof"); } };',
    compatibilityDate: '2025-07-18',
    d1Databases: { DB: 'financial-proof' },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  // D1 exec accepts newline separated statements; keep each trigger body together.
  const statements = schema.replace(/^--.*$/gm, '').match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|UNIQUE INDEX)[\s\S]*?;/g);
  assert.ok(statements?.length);
  for (const sql of statements) await db.prepare(sql).run();
  await db.prepare('INSERT INTO Wallet VALUES (?, ?, ?)').bind('user', 10000, 3000).run();
  await booking(db, 'booking', 'slot');
  return db;
}

async function booking(db, id, slot, amount = 5000, hold = now + 60000) {
  await db.prepare(`INSERT INTO Booking(id, customerId, slot, amount, holdUntil, cancelCutoff)
    VALUES (?, 'user', ?, ?, ?, ?)`).bind(id, slot, amount, hold, now + 86400000).run();
}
const pay = (db, overrides = {}) => payBooking(db, {
  paymentId: 'payment', bookingId: 'booking', customerId: 'user', useBonus: true, now, ...overrides,
});
async function approved(db, overrides = {}) {
  const { id = 'request', amount = 5000, createdAt = now, status = 'APPROVED' } = overrides;
  await db.prepare(`INSERT INTO RefundRequest VALUES (?, 'payment', ?, ?, 'owner', ?)`)
    .bind(id, amount, createdAt, status).run();
}
const refund = (db, overrides = {}) => refundBooking(db, {
  refundId: 'refund', requestId: 'request', paymentId: 'payment', ...overrides,
});
async function count(db, table) {
  return (await db.prepare(`SELECT count(*) AS count FROM ${table}`).first()).count;
}
async function balances(db) {
  const row = await db.prepare("SELECT paid, bonus FROM Wallet WHERE customerId = 'user'").first();
  return [row.paid, row.bonus];
}

test('bonus first payment and approved full refund restore original balances', async t => {
  const db = await setup(t);
  const paid = await pay(db);
  assert.equal(paid.bonusUsed, 3000);
  assert.equal(paid.paidUsed, 2000);
  assert.deepEqual(await balances(db), [8000, 0]);
  assert.equal((await db.prepare("SELECT status FROM Booking WHERE id = 'booking'").first()).status, 'CONFIRMED');
  assert.equal(await count(db, 'Notification'), 1);
  await approved(db);
  await refund(db);
  assert.deepEqual(await balances(db), [10000, 3000]);
  assert.equal((await db.prepare("SELECT status FROM Booking WHERE id = 'booking'").first()).status, 'CANCELLED');
  assert.equal((await db.prepare('SELECT status FROM RefundRequest').first()).status, 'REFUNDED');
  const total = await db.prepare('SELECT sum(paid) AS paid, sum(bonus) AS bonus FROM Ledger').first();
  assert.deepEqual([total.paid, total.bonus], [0, 0]);
});

test('useBonus false leaves bonus untouched', async t => {
  const db = await setup(t);
  await pay(db, { useBonus: false });
  assert.deepEqual(await balances(db), [5000, 3000]);
});

test('concurrent payment attempts have exactly one financial effect', async t => {
  const db = await setup(t);
  const results = await Promise.allSettled([pay(db), pay(db, { paymentId: 'other' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await count(db, 'Payment'), 1);
  assert.equal(await count(db, 'Ledger'), 1);
  assert.deepEqual(await balances(db), [8000, 0]);
});

test('two bookings cannot overspend a shared wallet', async t => {
  const db = await setup(t);
  await booking(db, 'second', 'second-slot', 9000);
  const results = await Promise.allSettled([pay(db), pay(db, { paymentId: 'second-pay', bookingId: 'second' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const [paid, bonus] = await balances(db);
  assert.ok(paid >= 0 && bonus >= 0);
  assert.equal(await count(db, 'Payment'), 1);
});

test('expired hold and wrong owner cannot debit wallet', async t => {
  const db = await setup(t);
  await assert.rejects(pay(db, { customerId: 'another-user' }), /NOT_FOUND_OR_FORBIDDEN/);
  await assert.rejects(pay(db, { now: now + 60000 }), /APPOINTMENT_PAYMENT_CONFLICT/);
  assert.deepEqual(await balances(db), [10000, 3000]);
  assert.equal(await count(db, 'Payment'), 0);
});

test('failure after debit rolls back payment, balance, booking and ledger', async t => {
  const db = await setup(t);
  await db.prepare(`CREATE TRIGGER injected_failure BEFORE INSERT ON Notification
    BEGIN SELECT RAISE(ABORT, 'INJECTED_FAILURE'); END;`).run();
  await assert.rejects(pay(db), /INJECTED_FAILURE/);
  assert.deepEqual(await balances(db), [10000, 3000]);
  assert.equal(await count(db, 'Payment'), 0);
  assert.equal(await count(db, 'Ledger'), 0);
  assert.equal((await db.prepare('SELECT status FROM Booking').first()).status, 'PENDING_PAYMENT');
});

test('refund rejects partial amount, missing approval and cutoff boundary', async t => {
  const db = await setup(t);
  await pay(db);
  for (const input of [
    { id: 'partial', amount: 1000 },
    { id: 'pending', status: 'PENDING' },
    { id: 'late', createdAt: now + 86400000 },
  ]) {
    await approved(db, input);
    await assert.rejects(refund(db, { requestId: input.id }), /REFUND_NOT_ELIGIBLE/);
  }
  assert.deepEqual(await balances(db), [8000, 0]);
  assert.equal(await count(db, 'Refund'), 0);
});

test('concurrent approved refunds cannot double credit wallet', async t => {
  const db = await setup(t);
  await pay(db);
  await approved(db);
  await approved(db, { id: 'second-request' });
  const results = await Promise.allSettled([
    refund(db), refund(db, { refundId: 'second-refund', requestId: 'second-request' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await count(db, 'Refund'), 1);
  assert.deepEqual(await balances(db), [10000, 3000]);
});

test('refund ledger failure rolls back wallet restoration and cancellation', async t => {
  const db = await setup(t);
  await pay(db);
  await approved(db);
  await db.prepare(`CREATE TRIGGER injected_refund_failure BEFORE INSERT ON Ledger
    WHEN NEW.kind = 'REFUND' BEGIN SELECT RAISE(ABORT, 'INJECTED_FAILURE'); END;`).run();
  await assert.rejects(refund(db), /INJECTED_FAILURE/);
  assert.deepEqual(await balances(db), [8000, 0]);
  assert.equal(await count(db, 'Refund'), 0);
  assert.equal((await db.prepare('SELECT status FROM Booking').first()).status, 'CONFIRMED');
  assert.equal((await db.prepare('SELECT status FROM RefundRequest').first()).status, 'APPROVED');
});

test('concurrent single capacity booking admits one request', async t => {
  const db = await setup(t);
  const results = await Promise.allSettled([
    booking(db, 'one', 'new-slot'), booking(db, 'two', 'new-slot'),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('corrupted deduction ledger blocks refund without changing balances', async t => {
  const db = await setup(t);
  await pay(db);
  await approved(db);
  await db.prepare("UPDATE Ledger SET paid = paid - 1 WHERE kind = 'PAYMENT'").run();
  await assert.rejects(refund(db), /WALLET_PAYMENT_LEDGER_MISMATCH/);
  assert.deepEqual(await balances(db), [8000, 0]);
  assert.equal(await count(db, 'Refund'), 0);
});

test('minor units stay exact and invalid amounts cannot create bookings', async t => {
  const db = await setup(t);
  await booking(db, 'cents', 'cent-slot', 12550);
  const result = await pay(db, { bookingId: 'cents', paymentId: 'cent-payment' });
  assert.deepEqual([result.paidUsed, result.bonusUsed], [9550, 3000]);
  assert.deepEqual(await balances(db), [450, 0]);
  for (const amount of [0, -1, 1.5, 10000000000]) {
    await assert.rejects(booking(db, `invalid-${amount}`, `slot-${amount}`, amount));
  }
});
