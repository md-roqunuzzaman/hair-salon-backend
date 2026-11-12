import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

async function context(t) {
  const ctx = await setup(t, 'true');
  const f = ctx.fixture;
  const control = body => ctx.direct('/__staff-schedule-test', { ...f, ...body });
  const extra = await control({ seed: true });
  const entry = (changes = {}) => ({ branchId: f.branchId, day: extra.day, startTime: '10:00', endTime: '14:00', ...changes });
  const save = (schedule, options = {}) => ctx.api(`/api/v1/staff/${f.staffId}/schedule`, {
    method: 'PUT', roleToken: ctx.ownerToken, body: { schedule }, ...options,
  });
  return { ...ctx, ...extra, control, entry, save };
}

for (const scenario of ['service reservation', 'standard package confirmation', 'group package live hold']) {
test(`bulk schedule protects future ${scenario}`, async t => {
  const ctx = await context(t);
  const { control, entry, save, fixture: f } = ctx;
  const appointment = scenario === 'service reservation'
    ? { orderNumber: 'AA0001', appointmentStatus: 'RESERVED' }
    : scenario === 'standard package confirmation'
      ? { orderNumber: 'AA0002', appointmentStatus: 'CONFIRMED', serviceId: null, packageId: ctx.standardPackageId }
      : { orderNumber: 'AA0003', serviceId: null, packageId: f.packageId, appointmentStatus: 'PENDING_PAYMENT', holdExpiresAt: new Date(Date.now() + 3600000).toISOString() };
  // Product-independent validation protects appointments regardless of their source flow.
  await control({ appointment });
  const before = await control({});
  for (const schedule of [
    [entry({ endTime: '11:30' })],
    [entry({ startTime: '11:30' })],
    [entry({ day: ctx.nextDay })],
  ]) {
    await save(schedule, { status: 409 });
    assert.deepEqual(await control({}), before);
  }
  const response = await save([entry(), entry({ day: ctx.nextDay })]);
  assert.deepEqual(response.data, { staffId: f.staffId });
  assert.deepEqual((await control({})).appointments, before.appointments);
});
}

test('bulk schedule uses date overrides in preference to weekly shifts', async t => {
  const ctx = await context(t);
  const { control, entry, save, fixture: f } = ctx;
  await control({ appointment: { orderNumber: 'BB0001' } });
  await control({ override: { branchId: f.branchId, startTime: '10:00', endTime: '13:00' } });
  const before = await control({});
  await save([entry({ day: ctx.nextDay })]);
  const after = await control({});
  assert.deepEqual(after.overrides, before.overrides);
  assert.deepEqual(after.appointments, before.appointments);
  assert.ok(!after.schedules.some(row => row.day === ctx.day));
});

test('an incompatible override cannot be replaced by matching weekly hours', async t => {
  const ctx = await context(t);
  await ctx.control({ appointment: { orderNumber: 'CC0001' } });
  await ctx.control({ override: { branchId: ctx.otherBranchId, startTime: '10:00', endTime: '14:00' } });
  const before = await ctx.control({});
  await ctx.save([ctx.entry(), ctx.entry({ day: ctx.nextDay })], { status: 409 });
  assert.deepEqual(await ctx.control({}), before);
});

test('manager replacement and weekday removal preserve out-of-scope rows and bookings', async t => {
  const ctx = await context(t);
  const { control, entry, save, fixture: f } = ctx;
  await control({ branchId: ctx.otherBranchId, appointment: { orderNumber: 'DD0001', startTime: '16:00', endTime: '17:00' } });
  const before = await control({});
  const retained = before.schedules.filter(row => row.branchId === ctx.otherBranchId);
  await save([entry({ day: ctx.nextDay })], { roleToken: ctx.managerToken });
  const after = await control({});
  assert.deepEqual(after.schedules.filter(row => row.branchId === ctx.otherBranchId), retained);
  assert.deepEqual(after.appointments, before.appointments);
  assert.ok(!after.schedules.some(row => row.branchId === f.branchId && row.day === ctx.day));
  const unchanged = await control({});
  await save([entry({ day: ctx.nextDay })], { roleToken: ctx.managerToken });
  assert.deepEqual(await control({}), unchanged, 'no-op must preserve IDs and avoid duplicate notifications');
});

test('manager cannot overlap retained branches or access unauthorized staff/branches', async t => {
  const ctx = await context(t);
  const before = await ctx.control({});
  await ctx.save([ctx.entry({ endTime: '16:00' })], { roleToken: ctx.managerToken, status: 409 });
  await ctx.save([ctx.entry({ branchId: ctx.otherBranchId })], { roleToken: ctx.managerToken, status: 403 });
  await ctx.save([ctx.entry()], { roleToken: ctx.otherManagerToken, status: 403 });
  await ctx.save([ctx.entry()], { roleToken: null, status: 401 });
  await ctx.save([ctx.entry()], { roleToken: undefined, status: 403 });
  assert.deepEqual(await ctx.control({}), before);
});

test('bulk schedule ignores past appointments and inactive/expired holds without changing them', async t => {
  const ctx = await context(t);
  for (const [index, appointment] of [
    { appointmentStatus: 'CANCELLED' }, { appointmentStatus: 'COMPLETED' },
    { appointmentStatus: 'EXPIRED' }, { appointmentStatus: 'NO_SHOW' },
    { appointmentStatus: 'PENDING_PAYMENT', holdExpiresAt: new Date(0).toISOString() },
    { appointmentStatus: 'PENDING_PAYMENT', holdExpiresAt: null },
    { appointmentStatus: 'RESERVED', date: '2020-01-01' },
  ].entries()) await ctx.control({ appointment: { orderNumber: `EE000${index}`, ...appointment } });
  const before = await ctx.control({});
  await ctx.save([ctx.entry({ day: ctx.nextDay })]);
  assert.deepEqual((await ctx.control({})).appointments, before.appointments);
});

test('insert failure rolls back deleted schedules and emits no staff notification', async t => {
  const ctx = await context(t);
  const before = await ctx.control({});
  await ctx.control({ failInsert: true });
  await ctx.save([ctx.entry({ day: ctx.nextDay })], { roleToken: ctx.managerToken, status: 500 });
  assert.deepEqual(await ctx.control({}), before);
});
