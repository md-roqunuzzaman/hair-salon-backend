import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const context = async t => {
  const ctx = await setup(t, 'true');
  const day = weekdays[new Date(ctx.fixture.date).getUTCDay()];
  const route = `/api/v1/branches/${ctx.fixture.branchId}/business-hours`;
  return { ...ctx, day, read: () => ctx.api(route).then(r => r.data),
    save: (hours, options = {}) => ctx.api(route, { method: 'PUT', roleToken: ctx.ownerToken, body: { hours }, ...options }) };
};
const period = (day, breaks) => ({ day, isClosed: false, openTime: '00:00', closeTime: '23:59', ...(breaks !== undefined && { breaks }) });
const midday = [{ startTime: '13:00', endTime: '14:00' }];

test('Worker branch breaks preserve legacy hours, manager scope, omitted breaks and explicit clearing', async t => {
  const ctx = await context(t);
  assert.equal((await ctx.read()).branchId, ctx.fixture.branchId);
  assert.deepEqual((await ctx.read()).hours[0].breaks, []);
  await ctx.save([period(ctx.day, midday)], { status: 403, roleToken: ctx.otherManagerToken });
  await ctx.save([period(ctx.day, midday)], { status: 401, roleToken: null });
  await ctx.api(`/api/v1/branches/${ctx.fixture.branchId}/business-hours`, { method: 'PUT', body: { hours: [period(ctx.day, midday)] }, status: 403 });
  await ctx.save([period(ctx.day, midday)], { roleToken: ctx.managerToken });
  const before = (await ctx.read()).hours[0].breaks;
  assert.deepEqual(before.map(({ startTime, endTime }) => ({ startTime, endTime })), midday);
  await ctx.save([period(ctx.day)]);
  assert.deepEqual((await ctx.read()).hours[0].breaks, before);
  await ctx.save([period(ctx.day, [])]);
  assert.deepEqual((await ctx.read()).hours[0].breaks, []);
  await ctx.save([period(ctx.day, midday)]);
  await ctx.save([{ day: ctx.day, isClosed: true }]);
  assert.deepEqual((await ctx.read()).hours[0].breaks, []);
});

test('Worker branch break validation rejects invalid, outside, overlapping and closed-day breaks without writes', async t => {
  const ctx = await context(t);
  const before = await ctx.read();
  for (const breaks of [
    [{ startTime: '14:00', endTime: '13:00' }],
    [{ startTime: '13:00', endTime: '13:00' }],
    [{ startTime: '24:00', endTime: '25:00' }],
    [{ startTime: '00:00', endTime: '01:00' }],
    [{ startTime: '13:00', endTime: '14:00' }, { startTime: '13:30', endTime: '15:00' }],
  ]) await ctx.save([period(ctx.day, breaks)], { status: 400 });
  await ctx.save([{ day: ctx.day, isClosed: true, breaks: midday }], { status: 400 });
  await ctx.save([period(ctx.day, []), period(ctx.day, [])], { status: 400 });
  assert.deepEqual(await ctx.read(), before);
  await ctx.save([period(ctx.day, [{ startTime: '13:00', endTime: '14:00' }, { startTime: '14:00', endTime: '15:00' }])]);
  assert.equal((await ctx.read()).hours[0].breaks.length, 2);
});

test('Worker breaks block every normal and group booking path while preserving boundary bookings and funds', async t => {
  const ctx = await context(t);
  const { api, fixture: f } = ctx;
  await ctx.save([period(ctx.day, midday)]);
  const body = { branchId: f.branchId, serviceId: f.serviceId, date: f.date };
  const available = async extra => (await api(`/api/v1/availability?${new URLSearchParams({ ...body, ...extra })}`)).data.slots;
  for (const extra of [{}, { staffId: f.staffId }]) {
    const slots = await available(extra);
    assert.ok(slots.some(slot => slot.startTime === '12:30' && slot.endTime === '13:00'));
    assert.ok(slots.some(slot => slot.startTime === '14:00'));
    for (const startTime of ['12:45', '13:00', '13:45']) assert.ok(!slots.some(slot => slot.startTime === startTime));
  }
  const before = await ctx.state();
  for (const route of ['reserve', 'pay-now', 'deposit']) {
    for (const selection of [{}, { staffId: f.staffId }]) await api(`/api/v1/appointments/${route}`, {
      body: { ...body, ...selection, startTime: '12:45' }, status: 409,
    });
  }
  await api('/api/v1/group-purchases', { body: { packageId: f.packageId, branchId: f.branchId, date: f.date, startTime: '13:00',
    quantity: 1, purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'RESERVE_NOW' }, status: 409 });
  assert.deepEqual(await ctx.state(), before);
  for (const [route, startTime, status] of [['reserve', '12:30', 'RESERVED'], ['pay-now', '14:00', 'PENDING_PAYMENT'], ['deposit', '14:30', 'PENDING_PAYMENT']]) {
    const result = (await api(`/api/v1/appointments/${route}`, { body: { ...body, startTime }, status: 201 })).data;
    assert.equal(result.appointmentStatus, status);
  }
  const purchase = (await api('/api/v1/group-purchases', { body: { packageId: f.packageId, branchId: f.branchId, quantity: 1 }, status: 201 })).data;
  await api(`/api/v1/group-purchases/${purchase.purchaseId}/pay-with-wallet`, { body: { useBonus: false } });
  const paid = await ctx.state();
  await api(`/api/v1/group-purchases/${purchase.purchaseId}/book-appointment`, { body: { branchId: f.branchId, date: f.date, startTime: '13:00' }, status: 409 });
  assert.deepEqual(await ctx.state(), paid);
  await api(`/api/v1/group-purchases/${purchase.purchaseId}/book-appointment`, { body: { branchId: f.branchId, date: f.date, startTime: '15:00' }, status: 201 });
});

test('Worker hours updates protect reservations and active holds and roll back earlier weekday writes', async t => {
  const ctx = await context(t);
  const { api, fixture: f } = ctx;
  const body = { branchId: f.branchId, serviceId: f.serviceId, date: f.date };
  await api('/api/v1/appointments/reserve', { body: { ...body, startTime: '10:00' }, status: 201 });
  await api('/api/v1/appointments/pay-now', { body: { ...body, startTime: '11:00' }, status: 201 });
  const before = await ctx.read();
  const otherDay = weekdays[(weekdays.indexOf(ctx.day) + 1) % 7];
  for (const startTime of ['10:00', '11:00']) {
    const endTime = `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`;
    await ctx.save([period(otherDay, midday), period(ctx.day, [{ startTime, endTime }])], { status: 409 });
    assert.deepEqual(await ctx.read(), before);
  }
  await ctx.save([{ day: ctx.day, isClosed: true }], { status: 409 });
  assert.deepEqual(await ctx.read(), before);
});
