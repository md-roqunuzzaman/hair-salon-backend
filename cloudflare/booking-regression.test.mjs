import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import crypto from 'node:crypto';

// Synthetic configuration: this suite must never connect to production services.
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1', JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3),
  JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3), STRIPE_SECRET_KEY: 'sk_test_fixture',
  R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'test-bucket', OPENAI_API_KEY: 'test-key',
});
const { prisma } = await import('../src/app/lib/prisma.ts');
const { Prisma } = await import('../generated/prisma/client.ts');
const { AvailabilityService } = await import('../src/app/module/availability/availability.service.ts');
const { resolveAvailableStaff, assertStaffSlotAvailable, assertBranchHourlyCapacityAvailable, appointmentService } =
  await import('../src/app/module/appointment/appointment.service.ts');
const { walletService } = await import('../src/app/module/wallet/wallet.service.ts');
const { jwtUtils } = await import('../src/app/utils/jwt.ts');
const { default: app } = await import('../src/app.ts');

const branchId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const appointmentId = '44444444-4444-4444-8444-444444444444';
const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const query = { branchId, serviceId, date };

function stubDelegate(t, model, method, implementation) {
  // Prisma delegate methods are dynamic proxy properties, which Node's method
  // mocker cannot replace using their property descriptors.
  const delegate = prisma[model];
  const original = delegate[method];
  const replacement = t.mock.fn(implementation);
  delegate[method] = replacement;
  t.after(() => { delegate[method] = original; });
  return replacement;
}

function fixture(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const data = {
    branch: { id: branchId, status: 'ACTIVE', bookingPolicy: {
      maximumAdvanceBookingDays: 30, minimumBookingNoticeMinutes: 0, slotIntervalMinutes: 30, cancellationCutoffHours: 12,
      allowedBookingMethods: ['PAY_NOW', 'DEPOSIT', 'RESERVE_NOW'], depositPercentage: 30,
    } },
    service: { name: 'Haircut', translations: { en: { name: 'Haircut' } }, price: new Prisma.Decimal('125.55'), status: 'ACTIVE', durationMinutes: 60, branches: [{ branchId }] },
    package: { name: 'Package', translations: { en: { name: 'Package' } }, packagePrice: new Prisma.Decimal('200.50'), status: 'ACTIVE', durationMinutes: 90, branches: [{ branchId }] },
    hours: { isClosed: false, openTime: '10:00', closeTime: '13:00' },
    capacity: { maxBookingsPerHour: 2 },
    staff: { id: staffId, status: 'ACTIVE', branches: [{ branchId }], services: [{ serviceId }], packages: [{ packageId: 'package' }] },
    eligible: [{ id: staffId }],
    schedules: [{ staffId, startTime: '10:00', endTime: '13:00' }],
    leave: [], staffBookings: [], branchBookings: [],
  };
  for (const [model, method, key] of [
    ['branch', 'findUnique', 'branch'], ['service', 'findUnique', 'service'],
    ['package', 'findUnique', 'package'], ['branchBusinessHour', 'findFirst', 'hours'],
    ['branchHourlyCapacity', 'findUnique', 'capacity'], ['staff', 'findUnique', 'staff'],
    ['staff', 'findMany', 'eligible'], ['staffSchedule', 'findMany', 'schedules'],
    ['staffUnavailability', 'findMany', 'leave'],
  ]) stubDelegate(t, model, method, async () => data[key]);
  const appointments = stubDelegate(t, 'appointment', 'findMany', async args =>
    args.where.staffId ? data.staffBookings : data.branchBookings);
  // Forbid explicit connections; query fixtures use a synthetic localhost URL.
  const originalConnect = prisma.$connect;
  prisma.$connect = async () => { throw new Error('External DB access forbidden'); };
  t.after(() => { prisma.$connect = originalConnect; });
  return { data, appointments };
}

function transactionFixture(t) {
  const { data } = fixture(t);
  const create = t.mock.fn(async ({ data: row }) => ({ id: appointmentId, ...row }));
  const notification = t.mock.fn(async ({ data: row }) => row);
  const tx = {
    $queryRaw: async () => [{ value: 1 }],
    branch: { findUnique: async () => data.branch },
    branchBookingPolicy: { findUnique: async () => data.branch.bookingPolicy },
    branchCancellationPolicy: { findUnique: async () => null },
    branchBusinessHour: { findFirst: async () => data.hours },
    staff: { findMany: async () => data.eligible },
    staffSchedule: { findMany: async () => data.schedules },
    staffUnavailability: { findMany: async () => data.leave },
    service: { findUnique: async () => data.service },
    package: { findUnique: async () => data.package },
    appointment: {
      findMany: async args => args.where.staffId ? data.staffBookings : data.branchBookings,
      findUnique: async () => ({ id: appointmentId, customerId: 'customer', branchId, staffId }),
      create,
    },
    user: { findMany: async () => [] },
    branchHourlyCapacity: { findUnique: async () => data.capacity },
    notification: { create: notification },
  };
  const original = prisma.$transaction;
  const transaction = t.mock.fn(async callback => callback(tx));
  prisma.$transaction = transaction;
  t.after(() => { prisma.$transaction = original; });
  return { data, tx, create, notification, transaction };
}

const methods = [
  ['PAY_NOW', 'createPayNowAppointment'], ['DEPOSIT', 'createDepositAppointment'], ['RESERVE_NOW', 'createReserveAppointment'],
];

for (const [method, serviceMethod] of methods) {
  test(`${method} preserves booking snapshot, money, hold or QR and isolation`, async t => {
    const { create, notification, transaction } = transactionFixture(t);
    const before = Date.now();
    const result = await appointmentService[serviceMethod]('customer', { ...query, startTime: '10:00' });
    const row = create.mock.calls[0].arguments[0].data;
    assert.equal(row.staffId, staffId);
    assert.equal(row.endTime, '11:00');
    assert.equal(row.itemName, 'Haircut');
    assert.deepEqual(row.itemNameTranslations, { en: { name: 'Haircut' } });
    assert.equal(row.price.toString(), '125.55');
    assert.equal(result.appointmentId, appointmentId);
    assert.equal(transaction.mock.calls.at(-1).arguments[1].isolationLevel, 'Serializable');
    if (method === 'RESERVE_NOW') {
      assert.equal(row.holdExpiresAt, null);
      assert.equal(result.appointmentStatus, 'RESERVED');
      assert.equal(result.paymentStatus, 'UNPAID');
      assert.match(result.qr.token, /^[a-f0-9]{64}$/);
      assert.equal(notification.mock.calls.length, 1);
    } else {
      assert.equal(result.appointmentStatus, 'PENDING_PAYMENT');
      assert.equal(result.paymentStatus, 'PENDING');
      assert.equal(result.qrAvailable, false);
      assert.ok(row.holdExpiresAt.getTime() >= before + 5 * 60000);
      assert.ok(row.holdExpiresAt.getTime() <= Date.now() + 5 * 60000);
    }
    if (method === 'DEPOSIT') {
      assert.equal(result.depositAmount, 37.67);
      assert.equal(result.remainingAmount, 87.88);
      assert.equal(result.price, 125.55);
    }
  });

  test(`${method} rejects a disabled merchant booking method before writing`, async t => {
    const { data, create } = transactionFixture(t);
    data.branch.bookingPolicy.allowedBookingMethods = [];
    await assert.rejects(appointmentService[serviceMethod]('customer', { ...query, startTime: '10:00' }), /booking is not enabled/);
    assert.equal(create.mock.calls.length, 0);
  });
}

test('package booking uses package duration and price snapshot', async t => {
  const { create } = transactionFixture(t);
  await appointmentService.createPayNowAppointment('customer', { branchId, packageId: 'package', date, startTime: '10:00' });
  const row = create.mock.calls[0].arguments[0].data;
  assert.equal(row.endTime, '11:30');
  assert.equal(row.price.toString(), '200.5');
  assert.equal(row.serviceId, null);
  assert.equal(row.packageId, 'package');
});

test('deposit rejects invalid percentage without creating an appointment', async t => {
  const { data, create } = transactionFixture(t);
  for (const percentage of [0, 101, null]) {
    data.branch.bookingPolicy.depositPercentage = percentage;
    await assert.rejects(appointmentService.createDepositAppointment('customer', { ...query, startTime: '10:00' }), /[Dd]eposit percentage/);
  }
  assert.equal(create.mock.calls.length, 0);
});

test('a conflict appearing after availability is rechecked inside the transaction', async t => {
  const { tx, create } = transactionFixture(t);
  tx.appointment.findMany = async () => [{ staffId, startTime: '10:00', endTime: '11:00' }];
  await assert.rejects(appointmentService.createPayNowAppointment('customer', { ...query, startTime: '10:00' }), /staff.*available/);
  assert.equal(create.mock.calls.length, 0);
});

test('availability preserves sorted slots, duration and capacity response', async t => {
  fixture(t);
  const result = await AvailabilityService.getAvailableSlots(query);
  assert.deepEqual(result.slots.map(s => s.startTime), ['10:00', '10:30', '11:00', '11:30', '12:00']);
  assert.equal(result.slots[0].endTime, '11:00');
  assert.deepEqual(result.slots[0].capacity, { maxBookingsPerHour: 2, used: 0, remaining: 2 });
  assert.equal(result.staffSelectionMode, 'AUTO');
});

test('past dates and advance window return existing unavailable reasons', async t => {
  const { data } = fixture(t);
  const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  assert.equal((await AvailabilityService.getAvailableSlots({ ...query, date: past })).unavailableReason, 'DATE_IN_PAST');
  data.branch.bookingPolicy.maximumAdvanceBookingDays = 0;
  assert.equal((await AvailabilityService.getAvailableSlots(query)).unavailableReason, 'BOOKING_WINDOW_EXCEEDED');
});

test('inactive branch and inactive/unassigned service retain errors', async t => {
  const { data } = fixture(t);
  data.branch.status = 'INACTIVE';
  await assert.rejects(AvailabilityService.getAvailableSlots(query), /Branch is inactive/);
  data.branch.status = 'ACTIVE';
  data.service.status = 'INACTIVE';
  await assert.rejects(AvailabilityService.getAvailableSlots(query), /Service is inactive/);
  data.service.status = 'ACTIVE'; data.service.branches = [];
  await assert.rejects(AvailabilityService.getAvailableSlots(query), /not available at this branch/);
});

test('closed branch and missing capacity fail closed', async t => {
  const { data } = fixture(t);
  data.hours.isClosed = true;
  assert.equal((await AvailabilityService.getAvailableSlots(query)).unavailableReason, 'BRANCH_CLOSED');
  data.hours.isClosed = false; data.capacity = null;
  assert.equal((await AvailabilityService.getAvailableSlots(query)).unavailableReason, 'CAPACITY_NOT_CONFIGURED');
});

test('selected staff must support the branch and service', async t => {
  const { data } = fixture(t);
  data.staff.branches = [];
  await assert.rejects(AvailabilityService.getAvailableSlots({ ...query, staffId }), /not eligible for this branch/);
  data.staff.branches = [{ branchId }]; data.staff.services = [];
  await assert.rejects(AvailabilityService.getAvailableSlots({ ...query, staffId }), /not eligible for this service/);
});

test('no eligible staff and no schedules retain distinct reasons', async t => {
  const { data } = fixture(t);
  data.eligible = [];
  assert.equal((await AvailabilityService.getAvailableSlots(query)).unavailableReason, 'NO_ELIGIBLE_STAFF');
  data.eligible = [{ id: staffId }]; data.schedules = [];
  assert.equal((await AvailabilityService.getAvailableSlots(query)).unavailableReason, 'NO_STAFF_SCHEDULE');
});

test('schedule and branch hours constrain the entire service duration', async t => {
  const { data } = fixture(t);
  data.schedules = [{ staffId, startTime: '10:30', endTime: '12:30' }];
  assert.deepEqual((await AvailabilityService.getAvailableSlots(query)).slots.map(s => s.startTime), ['10:30', '11:00', '11:30']);
});

test('leave and staff appointments block overlapping slots but allow touching endpoints', async t => {
  const { data } = fixture(t);
  data.leave = [{ staffId, startTime: '10:00', endTime: '11:00' }];
  data.staffBookings = [{ staffId, startTime: '12:00', endTime: '13:00' }];
  assert.deepEqual((await AvailabilityService.getAvailableSlots(query)).slots.map(s => s.startTime), ['11:00']);
});

test('capacity counts unrelated staff and every touched clock hour', async t => {
  const { data } = fixture(t);
  data.capacity.maxBookingsPerHour = 1;
  data.branchBookings = [{ id: 'other', startTime: '11:30', endTime: '12:00' }];
  assert.deepEqual((await AvailabilityService.getAvailableSlots(query)).slots.map(s => s.startTime), ['10:00', '12:00']);
});

test('minimum notice can exclude otherwise valid future slots', async t => {
  const { data } = fixture(t);
  data.branch.bookingPolicy.minimumBookingNoticeMinutes = 10 * 24 * 60;
  assert.equal((await AvailabilityService.getAvailableSlots(query)).unavailableReason, 'NO_AVAILABLE_SLOTS');
});

test('package duration and auto staff deduplication are preserved', async t => {
  const { data } = fixture(t);
  data.schedules.push({ staffId: 'second-staff', startTime: '10:00', endTime: '13:00' });
  const result = await AvailabilityService.getAvailableSlots({ branchId, packageId: 'package', date });
  assert.equal(result.slots[0].endTime, '11:30');
  assert.equal(result.slots.length, 4);
  assert.ok(result.slots.every(s => s.staffId === staffId));
});

test('rescheduling excludes its appointment and queries only active holds', async t => {
  const { appointments } = fixture(t);
  await AvailabilityService.getAvailableSlots({ ...query, excludeAppointmentId: appointmentId });
  assert.equal(appointments.mock.calls.length, 2);
  for (const call of appointments.mock.calls) {
    const where = call.arguments[0].where;
    assert.deepEqual(where.id, { not: appointmentId });
    assert.deepEqual(where.OR[0].appointmentStatus.in, ['RESERVED', 'CONFIRMED']);
    assert.equal(where.OR[1].appointmentStatus, 'PENDING_PAYMENT');
    assert.ok(where.OR[1].holdExpiresAt.gt instanceof Date);
  }
});

test('final transactional guards reject staff conflict and later-hour capacity', async t => {
  fixture(t);
  const tx = {
    appointment: { findMany: async () => [{ startTime: '11:30', endTime: '12:00' }] },
    branchHourlyCapacity: { findUnique: async () => ({ maxBookingsPerHour: 1 }) },
  };
  await assert.rejects(assertStaffSlotAvailable(tx, staffId, new Date(date), 630, 720, new Date()), /staff.*available/);
  await assert.rejects(assertBranchHourlyCapacityAvailable(tx, branchId, date, new Date(date), 630, 720, new Date()), /capacity has been reached/);
  await assertStaffSlotAvailable(tx, staffId, new Date(date), 600, 690, new Date());
});

test('Express booking endpoints preserve authentication, validation and response envelopes', async t => {
  fixture(t);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/appointments`;
  const payload = { ...query, startTime: '10:00' };
  const post = (path, body, token) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await post('/pay-now', payload)).status, 401);
  const user = { id: 'customer', email: 'test@example.com', name: 'Test', role: 'CUSTOMER', status: 'ACTIVE' };
  stubDelegate(t, 'user', 'findUnique', async () => user);
  const token = jwtUtils.createToken({ userId: 'customer', email: 'test@example.com' }, process.env.JWT_ACCESS_SECRET, '5m');
  assert.equal((await post('/pay-now', payload, 'invalid-token')).status, 401);
  user.role = 'STAFF';
  assert.equal((await post('/pay-now', payload, token)).status, 403);
  user.role = 'CUSTOMER'; user.status = 'INACTIVE';
  assert.equal((await post('/pay-now', payload, token)).status, 403);
  user.status = 'ACTIVE';
  assert.equal((await post('/pay-now', { ...payload, serviceId: null }, token)).status, 400);
  assert.equal((await post('/pay-now', { ...payload, packageId: appointmentId }, token)).status, 400);
  assert.equal((await post('/pay-now', { ...payload, date: '2030-02-30' }, token)).status, 400);
  const holdExpiresAt = new Date('2030-01-01T00:05:00.000Z');
  const booking = t.mock.method(appointmentService, 'createPayNowAppointment', async () => ({
    appointmentId, bookingMethod: 'PAY_NOW', appointmentStatus: 'PENDING_PAYMENT',
    paymentStatus: 'PENDING', holdExpiresAt, qrAvailable: false,
  }));
  const response = await post('/pay-now', payload, token);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(result, { success: true, statusCode: 201, message: 'Pay now appointment created successfully', data: {
    appointmentId, bookingMethod: 'PAY_NOW', appointmentStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING',
    holdExpiresAt: holdExpiresAt.toISOString(), qrAvailable: false,
  } });
  assert.equal(booking.mock.calls[0].arguments[0], 'customer');
  const wallet = t.mock.method(walletService, 'payAppointmentWithWallet', async () => ({
    paymentStatus: 'PAID', paidBalanceUsed: 20, bonusBalanceUsed: 30, remainingPaidBalance: 80, remainingBonusBalance: 0,
  }));
  const paid = await post(`/${appointmentId}/pay-with-wallet`, { useBonus: true }, token);
  assert.equal(paid.status, 200);
  assert.equal((await paid.json()).data.paymentStatus, 'PAID');
  assert.deepEqual(wallet.mock.calls[0].arguments, ['customer', appointmentId, { useBonus: true }]);
});

test('HTTP requests run all three real booking services through controller and validation', async t => {
  const { create } = transactionFixture(t);
  stubDelegate(t, 'user', 'findUnique', async () => ({ id: 'customer', email: 'test@example.com', name: 'Test', role: 'CUSTOMER', status: 'ACTIVE' }));
  const token = jwtUtils.createToken({ userId: 'customer' }, process.env.JWT_ACCESS_SECRET, '5m');
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  for (const [path, method, status] of [
    ['pay-now', 'PAY_NOW', 'PENDING_PAYMENT'], ['deposit', 'DEPOSIT', 'PENDING_PAYMENT'],
    ['reserve', 'RESERVE_NOW', 'RESERVED'],
  ]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/appointments/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `accessToken=${token}` },
      body: JSON.stringify({ ...query, startTime: '10:00' }),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.data.appointmentId, appointmentId);
    assert.equal(result.data.bookingMethod, method);
    assert.equal(result.data.appointmentStatus, status);
    if (method === 'DEPOSIT') assert.equal(result.data.depositAmount, 37.67);
    if (method === 'RESERVE_NOW') assert.match(result.data.qr.token, /^[a-f0-9]{64}$/);
    else assert.ok(!Number.isNaN(Date.parse(result.data.holdExpiresAt)));
  }
  assert.equal(create.mock.calls.length, 3);
});


function autoStaffFixture(t, ids = ['alex','james','saikat']) {
  const day = new Date(`${date}T00:00:00.000Z`);
  const now = new Date(day.getTime()-86400000);
  const data = { staff: ids.map(id=>({id,status:'ACTIVE',branches:[branchId],services:[serviceId],packages:['package']})),
    schedules: ids.map(staffId=>({staffId,startTime:'10:00',endTime:'13:00'})), leave: [], rows: [] };
  const queries=[];
  const tx={
    branchBusinessHour:{findFirst:async()=>({isClosed:false,openTime:'10:00',closeTime:'13:00'})},
    staff:{findMany:async({where})=>data.staff.filter(s=>s.status===where.status&&(!where.id||s.id===where.id)&&s.branches.includes(where.branches.some.branchId)&&(where.services?s.services.includes(where.services.some.serviceId):s.packages.includes(where.packages.some.packageId))).map(({id})=>({id}))},
    staffSchedule:{findMany:async()=>data.schedules},staffUnavailability:{findMany:async()=>data.leave},
    appointment:{findMany:async args=>{
      queries.push(args);
      return data.rows.filter(a=>args.where.staffId.in.includes(a.staffId)&&a.date.getTime()===args.where.date.getTime()&&a.id!==args.where.id?.not&&
        (args.where.OR ? ['RESERVED','CONFIRMED'].includes(a.appointmentStatus)||(a.appointmentStatus==='PENDING_PAYMENT'&&a.holdExpiresAt>now) : args.where.appointmentStatus.in.includes(a.appointmentStatus)));
    }},
  };
  const params={tx,branchId,serviceId,date,dateOnly:day,requestedStart:600,requestedEnd:660,now};
  const add=(staffId,count,patch={})=>{for(let i=0;i<count;i++)data.rows.push({id:`row-${data.rows.length}`,staffId,date:day,startTime:'08:00',endTime:'08:30',appointmentStatus:'RESERVED',...patch});};
  return {data,params,add,queries};
}

test('AUTO zero daily counts: deterministic random can select every candidate, not just ASC first',async t=>{
 const {params}=autoStaffFixture(t);let index=0;
 const random=t.mock.method(crypto,'randomInt',size=>{assert.equal(size,3);return index++;});
 assert.equal(await resolveAvailableStaff(params),'alex');assert.equal(await resolveAvailableStaff(params),'james');assert.equal(await resolveAvailableStaff(params),'saikat');assert.equal(random.mock.calls.length,3);
});

test('AUTO unique minimum is always chosen without random selection',async t=>{
 const {params,add}=autoStaffFixture(t);add('alex',3);add('james',1);add('saikat',2);
 t.mock.method(crypto,'randomInt',()=>{throw Error('Unique minimum must not use random');});
 for(let i=0;i<3;i++)assert.equal(await resolveAvailableStaff(params),'james');
});

test('AUTO tied minimum randomizes only among the minimum-count candidates',async t=>{
 const {params,add}=autoStaffFixture(t);add('alex',4);add('james',2);add('saikat',2);let index=0;
 t.mock.method(crypto,'randomInt',size=>{assert.equal(size,2);return index++;});
 assert.equal(await resolveAvailableStaff(params),'james');assert.equal(await resolveAvailableStaff(params),'saikat');
});

test('AUTO filters unavailable minimum before comparing daily workload',async t=>{
 for(const type of ['leave','shortSchedule','conflict'])await t.test(type,async t=>{
  const {params,data,add,queries}=autoStaffFixture(t);add('james',2);add('saikat',3);
  if(type==='leave')data.leave.push({staffId:'alex',startTime:'10:30',endTime:'11:30'});
  if(type==='shortSchedule')data.schedules[0].endTime='10:30';
  if(type==='conflict')add('alex',1,{startTime:'10:30',endTime:'11:00',appointmentStatus:'CONFIRMED'});
  assert.equal(await resolveAvailableStaff(params),'james');
  assert.deepEqual(queries.find(q=>q.where.appointmentStatus).where.staffId.in,['james','saikat']);
 });
});

test('AUTO excludes inactive, other-branch and ineligible-service/package minimum candidates',async t=>{
 for(const type of ['inactive','branch','service','package'])await t.test(type,async t=>{
  const {params,data,add}=autoStaffFixture(t);add('james',2);add('saikat',3);
  if(type==='inactive')data.staff[0].status='INACTIVE';if(type==='branch')data.staff[0].branches=[];
  if(type==='service')data.staff[0].services=[];if(type==='package'){delete params.serviceId;params.packageId='package';data.staff[0].packages=[];}
  assert.equal(await resolveAvailableStaff(params),'james');
 });
});

test('AUTO workload uses only selected date and all services/packages and assignment methods',async t=>{
 const {params,add,queries}=autoStaffFixture(t,['alex','james']);
 add('alex',1,{appointmentStatus:'COMPLETED',serviceId:'other-service',packageId:'other-package',bookingMethod:'GROUP_PURCHASE'});
 add('james',5,{date:new Date(params.dateOnly.getTime()-86400000)});add('james',5,{date:new Date(params.dateOnly.getTime()+86400000)});
 assert.equal(await resolveAvailableStaff(params),'james');
 const where=queries.find(q=>q.where.appointmentStatus).where;
 assert.equal(where.date.getTime(),params.dateOnly.getTime());
 for(const field of ['serviceId','packageId','bookingMethod','branchId'])assert.equal(where[field],undefined);
 assert.deepEqual(where.appointmentStatus.in,['RESERVED','CONFIRMED','COMPLETED']);
});

test('AUTO counts each qualifying status and excludes holds/cancelled/expired/no-show',async t=>{
 for(const status of ['RESERVED','CONFIRMED','COMPLETED'])await t.test(status,async t=>{
  const {params,add}=autoStaffFixture(t,['alex','james']);add('alex',1,{appointmentStatus:status});assert.equal(await resolveAvailableStaff(params),'james');
 });
 for(const status of ['PENDING_PAYMENT','CANCELLED','EXPIRED','NO_SHOW'])await t.test(status,async t=>{
  const {params,add}=autoStaffFixture(t,['alex','james']);add('james',1,{appointmentStatus:'COMPLETED'});add('alex',5,{appointmentStatus:status,holdExpiresAt:new Date(params.now.getTime()+60000)});assert.equal(await resolveAvailableStaff(params),'alex');
 });
});

test('AUTO active PENDING_PAYMENT hold blocks the full slot while expired hold does not',async t=>{
 const {params,add,data}=autoStaffFixture(t,['alex','james']);add('james',2,{appointmentStatus:'COMPLETED'});
 add('alex',1,{appointmentStatus:'PENDING_PAYMENT',startTime:'10:30',endTime:'11:30',holdExpiresAt:new Date(params.now.getTime()+60000)});
 assert.equal(await resolveAvailableStaff(params),'james');
 data.rows.at(-1).holdExpiresAt=new Date(params.now.getTime()-1);assert.equal(await resolveAvailableStaff(params),'alex');
});

test('manual staff ignores fairness/randomness and retains existing unavailable error',async t=>{
 const {params,add,queries,data}=autoStaffFixture(t);add('alex',8);params.staffId='alex';
 t.mock.method(crypto,'randomInt',()=>{throw Error('Manual selection must not randomize');});
 assert.equal(await resolveAvailableStaff(params),'alex');assert.equal(queries.some(q=>q.where.appointmentStatus),false);
 data.leave.push({staffId:'alex',startTime:'10:30',endTime:'11:00'});
 await assert.rejects(resolveAvailableStaff(params),{message:'Selected staff is no longer available for this time slot',statusCode:409});
});

test('consecutive AUTO RESERVE_NOW bookings recalculate counts inside existing serializable transactions',async t=>{
 const {data,tx,create}=transactionFixture(t);const ids=['alex','james','saikat'];const rows=[];
 data.eligible=ids.map(id=>({id}));data.schedules=ids.map(staffId=>({staffId,startTime:'10:00',endTime:'13:00'}));
 tx.appointment.findMany=async args=>args.where.appointmentStatus?rows.filter(a=>args.where.staffId.in.includes(a.staffId)&&a.date.getTime()===args.where.date.getTime()&&args.where.appointmentStatus.in.includes(a.appointmentStatus)):rows;
 tx.appointment.create=async({data:row})=>{const result={id:`row-${rows.length}`,...row};rows.push(result);return result;};
 t.mock.method(crypto,'randomInt',()=>0);
 for(const time of ['10:00','11:00','12:00'])await appointmentService.createReserveAppointment('customer',{...query,startTime:time});
 assert.deepEqual(rows.map(r=>r.staffId),ids);
});

// Exact reported request, through real HTTP validation/controllers and both services.
// Only storage is mocked; availability and staff assignment are not stubbed.
async function reportedAutoBookingFixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T08:00:00.000Z') });
  const state = transactionFixture(t);
  const { data } = state;
  const request = {
    branchId: 'f7318524-db7c-49cf-8bc4-bfc6ff5c6b97',
    serviceId: 'ddead693-8445-4cb2-a9f5-f824afd6d201',
    date: '2026-11-15', startTime: '15:00', bookingMethod: 'RESERVE_NOW',
  };
  const david = '023605b9-8628-45aa-be31-82d56635ef6d';
  const other = '33333333-3333-4333-8333-333333333334';
  data.branch.id = request.branchId;
  data.service.durationMinutes = 45;
  data.service.branches = [{ branchId: request.branchId }];
  data.hours = { isClosed: false, openTime: '10:00', closeTime: '20:00' };
  data.capacity.maxBookingsPerHour = 4;
  data.eligible = [{ id: david }, { id: other }];
  data.schedules = data.eligible.map(({ id }) => ({ staffId: id, startTime: '10:00', endTime: '20:00' }));
  data.staff = { ...data.staff, id: david, branches: [{ branchId: request.branchId }], services: [{ serviceId: request.serviceId }] };
  stubDelegate(t, 'user', 'findUnique', async () => ({ id: 'customer', role: 'CUSTOMER', status: 'ACTIVE' }));
  const token = jwtUtils.createToken({ userId: 'customer' }, process.env.JWT_ACCESS_SECRET, '5m');
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const availability = async () => {
    const params = new URLSearchParams({ branchId: request.branchId, serviceId: request.serviceId, date: request.date, staff: 'ANY' });
    const response = await fetch(`${base}/availability?${params}`);
    assert.equal(response.status, 200);
    const json = await response.json();
    const slot = json.data.slots.find(slot => slot.startTime === '15:00');
    assert.equal(slot.endTime, '15:45');
    assert.equal(slot.staffId, david);
    assert.equal(slot.available, true);
    assert.deepEqual(slot.capacity, { maxBookingsPerHour: 4, used: 0, remaining: 4 });
    return slot;
  };
  const post = (body = request, path = '/appointments/reserve') => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return { ...state, request, david, other, availability, post };
}

test('reported AUTO slot remains bookable; preview staff is not the assigned staff', async t => {
  const { availability, post, create, other } = await reportedAutoBookingFixture(t);
  t.mock.method(crypto, 'randomInt', () => 1);
  await availability();
  const response = await post();
  assert.equal(response.status, 201, await response.text());
  const row = create.mock.calls[0].arguments[0].data;
  assert.equal(row.staffId, other);
  assert.equal(row.startTime, '15:00'); assert.equal(row.endTime, '15:45');
  assert.equal(row.date.toISOString(), '2026-11-15T00:00:00.000Z');
  assert.equal(row.appointmentStatus, 'RESERVED');
});

test('reported slot manual booking still selects the explicit staff; root POST is not a booking contract', async t => {
  const { availability, post, create, request, david } = await reportedAutoBookingFixture(t);
  t.mock.method(crypto, 'randomInt', () => { throw Error('Manual selection must not randomize'); });
  await availability();
  assert.equal((await post(request, '/appointments')).status, 404);
  assert.equal(create.mock.calls.length, 0);
  assert.equal((await post({ ...request, staffId: david })).status, 201);
  assert.equal(create.mock.calls[0].arguments[0].data.staffId, david);
});

test('reported slot returns the exact 409 if availability changes before POST', async t => {
  const { availability, post, create, data, transaction } = await reportedAutoBookingFixture(t);
  await availability();
  data.leave = data.eligible.map(({ id }) => ({ staffId: id, startTime: '15:00', endTime: '15:45' }));
  const response = await post();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).message, 'The selected time slot is no longer available');
  assert.equal(create.mock.calls.length, 0); assert.equal(transaction.mock.calls.length, 0);
});

test('reported slot retains exact 409 on exhausted serializable retries', async t => {
  const { availability, post, create } = await reportedAutoBookingFixture(t);
  await availability();
  const original = prisma.$transaction;
  const attempts = t.mock.fn(async () => { throw new Prisma.PrismaClientKnownRequestError('Synthetic conflict', { code: 'P2034', clientVersion: 'test' }); });
  prisma.$transaction = attempts;
  t.after(() => { prisma.$transaction = original; });
  const response = await post();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).message, 'The selected time slot is no longer available');
  assert.equal(attempts.mock.calls.length, 3); assert.equal(create.mock.calls.length, 0);
});
