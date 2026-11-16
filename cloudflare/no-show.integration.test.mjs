import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

test('real Worker scheduled cron marks no-shows atomically and remains idempotent', async t => {
  const ctx = await setup(t, 'true');
  const cases = await ctx.direct('/__no-show-test', { prepare: true, ...ctx.fixture });
  const read = (clearFailure = false) => ctx.direct('/__no-show-test', { ids: Object.values(cases), clearFailure });
  const financial = async () => {
    const state = await ctx.state();
    return { payments: state.payments, refunds: state.refunds, wallets: state.wallets, ledger: state.ledger, purchases: state.purchases, packages: state.packages };
  };
  const before = await read();
  const money = await financial();
  // Invokes the production scheduled() handler, not the service directly.
  await ctx.scheduled();
  const first = await read();
  for (const name of ['payNow', 'reserve', 'deposit', 'legacyTimezone']) {
    const row = first.appointments.find(row => row.id === cases[name]);
    const old = before.appointments.find(old => old.id === row.id);
    assert.equal(row.appointmentStatus, 'NO_SHOW');
    assert.ok(row.noShowAt);
    assert.equal(row.paymentStatus, old.paymentStatus);
    assert.equal(row.price, old.price);
    assert.equal(first.notifications.filter(note => note.appointmentId === row.id).length, 1);
    const notification = first.notifications.find(note => note.appointmentId === row.id);
    for (const language of ['en', 'zh-CN', 'zh-HK']) assert.ok(notification.translations[language].message);
    const audit = first.audits.find(audit => audit.entityId === row.id);
    assert.equal(audit.userId, null);
    assert.equal(audit.metadata.gracePeriodMinutes, 15);
  }
  for (const name of ['checkedIn', 'future', 'pending', 'cancelled', 'expired', 'alreadyNoShow', 'completed', 'rollback']) {
    const row = first.appointments.find(row => row.id === cases[name]);
    assert.deepEqual(row, before.appointments.find(old => old.id === row.id));
    assert.ok(!first.notifications.some(note => note.appointmentId === row.id));
    assert.ok(!first.audits.some(audit => audit.entityId === row.id));
  }
  assert.deepEqual(await financial(), money);
  await read(true);
  await ctx.scheduled();
  const recovered = await read();
  assert.equal(recovered.appointments.find(row => row.id === cases.rollback).appointmentStatus, 'NO_SHOW');
  assert.equal(recovered.notifications.length, 5);
  assert.equal(recovered.audits.length, 5);
  await ctx.scheduled();
  assert.deepEqual(await read(), recovered);
  assert.deepEqual(await financial(), money);
  assert.equal((await ctx.fetch('https://test/__internal/cron')).status, 404);
});
