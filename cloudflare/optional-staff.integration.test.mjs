import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

test('a configured package with an ineligible stylist cannot silently become staff-free', async t => {
  const ctx = await setup(t, 'true');
  const f = ctx.fixture;
  const control = body => ctx.direct('/__staff-availability-test', { ...f, ...body });
  const { standardPackageId } = await control({ seed: true });
  await control({ staffService: false });
  const product = { branchId: f.branchId, packageId: standardPackageId, date: f.date };
  const slots = (await ctx.api(`/api/v1/availability?${new URLSearchParams(product)}`)).data;
  assert.notEqual(slots.staffSelectionMode, 'NO_STAFF');
  assert.deepEqual(slots.slots, []);
  const before = await ctx.state();
  await ctx.api('/api/v1/appointments/reserve', { body: { ...product, startTime: '10:00' }, status: 409 });
  assert.deepEqual(await ctx.state(), before);
});

test('staff-free payment, QR, cancellation, review guard and package redemption retain their contracts', async t => {
  const ctx = await setup(t, 'true');
  const f = ctx.fixture;
  const control = body => ctx.direct('/__staff-availability-test', { ...f, ...body });
  const { standardPackageId } = await control({ seed: true });
  await control({ staffService: false });
  const book = async (path, startTime, product = { serviceId: f.serviceId }) => (await ctx.api(`/api/v1/appointments/${path}`, {
    status: 201, body: { branchId: f.branchId, date: f.date, startTime, ...product },
  })).data.appointmentId;
  const appointment = async id => (await ctx.state()).appointments.find(row => row.id === id);
  for (const [method, startTime] of [['pay-now','10:00'],['deposit','11:00']]) {
    const id = await book(method, startTime);
    await ctx.api(`/api/v1/appointments/${id}/pay-with-wallet`, { body: { useBonus: false } });
    const row = await appointment(id);
    assert.equal(row.staffId, null);
    const view = (await ctx.api(`/api/v1/appointments/${id}`)).data;
    assert.equal(view.staff, null);
    await ctx.api('/api/v1/appointments/verify-qr', { roleToken: ctx.otherManagerToken, body: { qrToken: row.qrToken, branchId: f.branchId }, status: 403 });
    await ctx.api('/api/v1/appointments/verify-qr', { roleToken: ctx.ownerToken, body: { qrToken: row.qrToken, branchId: f.branchId } });
    await ctx.api('/api/v1/appointments/verify-qr', { roleToken: ctx.ownerToken, body: { qrToken: row.qrToken, branchId: f.branchId }, status: 409 });
    if (method === 'deposit') {
      await ctx.api(`/api/v1/wallet/${id}/remaining-payment/wallet`, { body: { useBonus: false } });
    }
    assert.equal((await appointment(id)).paymentStatus, 'PAID');
    await ctx.api('/__policy-test', { body: { appointmentId: id, status: 'COMPLETED' } });
    const rejected = await ctx.api(`/api/v1/appointments/${id}/reviews`, { body: { rating: 5, comment: 'Staff-free appointment review' }, status: 409 });
    assert.equal(rejected.message, 'REVIEW_NOT_ALLOWED');
    const pending = (await ctx.api('/api/v1/reviews/pending')).data;
    assert.ok(!JSON.stringify(pending).includes(id));
  }
  await control({ packageId: standardPackageId, staffPackage: false });
  const cancelledId = await book('reserve','12:00',{ packageId: standardPackageId });
  assert.equal((await appointment(cancelledId)).staffId, null);
  const preview = (await ctx.api(`/api/v1/cancellation-refund/appointments/${cancelledId}/preview`)).data;
  assert.equal(preview.canCancel, true);
  const beforeCancel = await ctx.state();
  await ctx.api(`/api/v1/cancellation-refund/appointments/${cancelledId}/cancel`, { body: {
    reason: 'Staff-free cancellation test', idempotencyKey: crypto.randomUUID(), previewToken: preview.previewToken,
  } });
  const afterCancel = await ctx.state();
  assert.equal((await appointment(cancelledId)).appointmentStatus, 'CANCELLED');
  for (const key of ['payments','wallets','ledger','refunds']) assert.deepEqual(afterCancel[key], beforeCancel[key]);
  await control({ staffPackage: false });
  const purchase = (await ctx.api('/api/v1/group-purchases', { status: 201, body: { packageId: f.packageId, branchId: f.branchId, quantity: 1 } })).data;
  await ctx.api(`/api/v1/group-purchases/${purchase.purchaseId}/pay-with-wallet`, { body: { useBonus: false } });
  const redeemed = (await ctx.api(`/api/v1/group-purchases/${purchase.purchaseId}/book-appointment`, { status: 201,
    body: { branchId: f.branchId, date: f.date, startTime: '13:00' },
  })).data;
  const groupRow = (await ctx.state()).appointments.find(row => row.groupPurchaseId === purchase.purchaseId);
  assert.ok(redeemed.appointmentId);
  assert.equal(groupRow.staffId, null);
  assert.equal(groupRow.bookingMethod, 'GROUP_PURCHASE');
});

test('temporary branch move cannot enable staff-free fallback and remains bookable at the destination', async t => {
  const ctx = await setup(t, 'true');
  const f = ctx.fixture;
  const control = body => ctx.direct('/__staff-availability-test', { ...f, ...body });
  const { otherBranchId } = await control({ seed: true });
  await ctx.api(`/api/v1/staff/${f.staffId}/schedule-overrides`, {
    roleToken: ctx.ownerToken, status: 201,
    body: { branchId: otherBranchId, date: f.date, startTime: '10:00', endTime: '14:00' },
  });
  const availability = async (branchId, staffId) => (await ctx.api(`/api/v1/availability?${new URLSearchParams({ branchId, serviceId: f.serviceId, date: f.date, ...(staffId ? { staffId } : {}) })}`)).data;
  const home = await availability(f.branchId);
  assert.notEqual(home.staffSelectionMode, 'NO_STAFF');
  assert.deepEqual(home.slots, []);
  const before = await ctx.state();
  await ctx.api('/api/v1/appointments/reserve', { status: 409, body: { branchId: f.branchId, serviceId: f.serviceId, date: f.date, startTime: '10:00' } });
  assert.deepEqual(await ctx.state(), before);
  for (const [startTime, selected] of [['10:00',false],['11:00',true]]) {
    const preview = await availability(otherBranchId, selected ? f.staffId : undefined);
    assert.ok(preview.slots.some(slot => slot.startTime === startTime && slot.staffId === f.staffId));
    const result = (await ctx.api('/api/v1/appointments/reserve', { status: 201, body: {
      branchId: otherBranchId, serviceId: f.serviceId, date: f.date, startTime, ...(selected ? { staffId: f.staffId } : {}),
    } })).data;
    assert.equal((await ctx.state()).appointments.find(row => row.id === result.appointmentId).staffId, f.staffId);
  }
});

test('Worker persists staff-free service bookings for all payment methods and enforces branch capacity', async t => {
  const ctx = await setup(t, 'true');
  const thursday = new Date(Date.now() + 7 * 86400000);
  thursday.setUTCDate(thursday.getUTCDate() + (4 - thursday.getUTCDay() + 7) % 7);
  const f = { ...ctx.fixture, date: thursday.toISOString().slice(0, 10) };
  const control = body => ctx.direct('/__staff-availability-test', { ...f, ...body });
  await control({ seed: true });
  await control({ staffService: false });
  const availability = async () => (await ctx.api(`/api/v1/availability?${new URLSearchParams({ branchId: f.branchId, serviceId: f.serviceId, date: f.date })}`)).data;
  const before = await availability();
  assert.equal(before.staffSelectionMode, 'NO_STAFF');
  assert.ok(before.slots.length > 0);
  assert.ok(before.slots.every(slot => slot.staffId === null));
  for (const [path, startTime] of [['reserve','10:00'],['pay-now','11:00'],['deposit','12:00']]) {
    const result = (await ctx.api(`/api/v1/appointments/${path}`, {
      body: { branchId: f.branchId, serviceId: f.serviceId, date: f.date, startTime }, status: 201,
    })).data;
    const state = await ctx.state();
    const appointment = state.appointments.find(row => row.id === result.appointmentId);
    assert.ok(appointment, 'booking must be persisted in the actual SQLite Worker');
    assert.equal(appointment.staffId, null);
  }
  const tenOClock = (await availability()).slots.find(slot => slot.startTime === '10:00');
  assert.ok(tenOClock);
  for (let i = 0; i < tenOClock.capacity.remaining; i++) {
    await ctx.api('/api/v1/appointments/reserve', {
      body: { branchId: f.branchId, serviceId: f.serviceId, date: f.date, startTime: '10:00' }, status: 201,
    });
  }
  await ctx.api('/api/v1/appointments/reserve', {
    body: { branchId: f.branchId, serviceId: f.serviceId, date: f.date, startTime: '10:00' }, status: 409,
  });
  assert.ok(!(await availability()).slots.some(slot => slot.startTime === '10:00'));
  // With configured staff, temporary inactivity must never become staff-free availability.
  await control({ staffService: true, staffStatus: 'INACTIVE' });
  const inactive = await availability();
  assert.notEqual(inactive.staffSelectionMode, 'NO_STAFF');
  assert.equal(inactive.slots.length, 0);
});
