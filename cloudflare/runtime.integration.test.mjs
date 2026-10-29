import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';

// Use the same Miniflare/workerd version as Wrangler's deployment toolchain.
const require = createRequire(path.resolve('node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
test('Cloudflare: real Express auth, sessions, booking and wallet persistence', async t => {
  const mf = new Miniflare({
    log: new Log(LogLevel.NONE),
    modules: true, scriptPath: 'cloudflare/.build/integration.mjs',
    compatibilityDate: '2025-10-11', compatibilityFlags: ['nodejs_compat', 'enable_nodejs_http_server_modules'],
    modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
    durableObjects: { SALON_DB: { className: 'SalonTestDatabase', useSQLite: true } },
    bindings: {
      NODE_ENV: 'production', CORS_ORIGIN: 'https://frontend.example.com', BCRYPT_SALT_ROUNDS: '10',
      JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3),
      STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_test', OPENAI_API_KEY: 'test-key',
      R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret',
      R2_BUCKET_NAME: 'test-bucket', EMAIL_ENCRYPTION_KEY: 'ab'.repeat(32), EMAIL_OUTBOX_ENABLED: 'false',
      BOOTSTRAP_TOKEN: 'test-bootstrap-token-'.repeat(3),
      BRAND_OWNER_NAME: 'Owner', BRAND_OWNER_EMAIL: 'owner@example.com', BRAND_OWNER_PASSWORD: 'OwnerPassword123!',
    },
  });
  t.after(() => mf.dispose());
  let cookie = '';
  const api = async (url, { method = 'GET', body, status = 200, headers = {} } = {}) => {
    const response = await mf.dispatchFetch(`https://test${url}`, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${url}: ${text}`);
    if (status >= 400) {
      const failure = JSON.parse(text);
      assert.equal(failure.success, false);
      assert.equal(failure.statusCode, status);
      assert.equal(typeof failure.name, 'string');
      if (status !== 500) assert.notEqual(failure.name, 'Internal Server Error');
      if (status !== 500) assert.notEqual(failure.message, 'Internal Server Error');
      assert.doesNotMatch(text, /"stack"|SELECT secret|password=|provider-token|postgresql:\/\//);
    }
    return { response, data: JSON.parse(text) };
  };
  await api('/');
  const timestamp = Math.floor(Date.now() / 1000);
  const eventBody = JSON.stringify({ id: 'evt_worker_test', object: 'event', type: 'account.updated', created: timestamp, data: { object: { id: 'acct_test' } } });
  const signature = createHmac('sha256', 'whsec_test').update(`${timestamp}.${eventBody}`).digest('hex');
  const webhook = signatureHeader => mf.dispatchFetch('https://test/api/v1/payments/stripe/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signatureHeader }, body: eventBody,
  });
  assert.equal((await webhook(`t=${timestamp},v1=invalid`)).status, 400);
  assert.equal((await webhook(`t=${timestamp},v1=${signature}`)).status, 200);
  assert.equal((await webhook(`t=${timestamp},v1=${signature}`)).status, 200);
  const setup = () => mf.dispatchFetch('https://test/__setup', { method: 'POST', headers: { authorization: `Bearer ${'test-bootstrap-token-'.repeat(3)}` } });
  assert.equal((await mf.dispatchFetch('https://test/__setup', { method: 'POST' })).status, 404);
  assert.equal((await setup()).status, 200);
  assert.equal((await setup()).status, 409);
  const missingAuth = await api('/api/v1/wallet', { status: 401 });
  assert.equal(missingAuth.data.name, 'Unauthorized');
  assert.match(missingAuth.data.message, /not logged in/);
  const expiredToken = jwt.sign({ userId: '11111111-1111-4111-8111-111111111111' }, 'test-access-secret-'.repeat(3), { expiresIn: -1 });
  const expiredAuth = await api('/api/v1/wallet', { status: 401, headers: { authorization: `Bearer ${expiredToken}` } });
  assert.match(expiredAuth.data.message, /session has expired/);
  await api('/api/v1/wallet', { status: 401, headers: { authorization: 'Bearer invalid' } });
  await api('/missing-route?token=private', { status: 404 });
  for (const path of ['/__worker-error', '/__do-error']) {
    assert.deepEqual((await api(path, { status: 500 })).data, { success: false, statusCode: 500, name: 'Internal Server Error', message: 'Internal Server Error' });
  }
  const credentials = { email: 'customer@example.com', password: 'StrongPassword123!' };
  const registered = await api('/api/v1/auth/register', { method: 'POST', body: { ...credentials, name: 'Customer' }, status: 201 });
  await api('/api/v1/auth/register', { method: 'POST', body: { ...credentials, name: 'Customer' }, status: 409 });
  const login = await api('/api/v1/auth/login', { method: 'POST', body: credentials });
  const refresh = login.data.data.refreshToken;
  cookie = `accessToken=${login.data.data.accessToken}; refreshToken=${refresh}`;
  const invalidBooking = await api('/api/v1/appointments/pay-now', { method: 'POST', body: {}, status: 400 });
  assert.ok(invalidBooking.data.details.length > 0);
  await api('/api/v1/branches', { method: 'POST', body: {}, status: 403 });
  const presigned = await api('/api/v1/uploads/images/presign', { method: 'POST', body: {
    fileName: 'avatar.png', contentType: 'image/png', fileSize: 100, purpose: 'USER_AVATAR', entityId: registered.data.data.id,
  } });
  assert.match(presigned.data.data.uploadUrl, /^https:\/\/test-account\.r2\.cloudflarestorage\.com\//);
  assert.match(presigned.data.data.uploadUrl, /X-Amz-Signature=/);
  assert.doesNotMatch(presigned.data.data.uploadUrl, /x-amz-checksum-crc32=/i);
  await api('/api/v1/wallet');
  const fixture = await api('/__fixtures', { method: 'POST', body: { customerId: registered.data.data.id } });
  for (const [type, status] of [['unique', 409], ['fk', 400], ['notnull', 400], ['money', 400]]) {
    await api(`/__constraint?type=${type}`, { status });
  }
  assert.deepEqual((await api('/__rollback')).data, { rejected: true, unchanged: true });
  const booking = fixture.data;
  const availability = await api(`/api/v1/availability?${new URLSearchParams({ branchId: booking.branchId, serviceId: booking.serviceId, date: booking.date })}`);
  assert.ok(availability.data.data.slots.length > 0);
  const created = await api('/api/v1/appointments/pay-now', { method: 'POST', body: { ...booking, startTime: '10:00' }, status: 201 });
  const id = created.data.data.appointmentId;
  assert.match(created.data.data.orderNumber, /^[A-HJ-NP-Z2-9]{6}$/);
  const myAppointments = (await api('/api/v1/appointments/my?type=UPCOMING')).data.data;
  assert.equal(myAppointments.items.find(item => item.id === id)?.orderNumber, created.data.data.orderNumber);
  const conflict = await mf.dispatchFetch('https://test/api/v1/appointments/reserve', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ...booking, startTime: '10:00' }) });
  assert.ok(conflict.status >= 400 && conflict.status < 500, await conflict.text());
  await api(`/api/v1/wallet/${id}/pay-with-wallet`, { method: 'POST', body: { useBonus: true } });
  const before = (await api('/api/v1/wallet')).data.data;
  const replay = await mf.dispatchFetch(`https://test/api/v1/wallet/${id}/pay-with-wallet`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ useBonus: true }) });
  assert.ok(replay.status >= 400 && replay.status < 500, await replay.text());
  assert.deepEqual((await api('/api/v1/wallet')).data.data, before);
  assert.equal(before.totalBalance, 974.45);
  await api('/api/v1/appointments/deposit', { method: 'POST', body: { ...booking, startTime: '12:00' }, status: 201 });
  await api('/api/v1/appointments/reserve', { method: 'POST', body: { ...booking, startTime: '14:00' }, status: 201 });
  const snapshot = (await api('/__snapshot')).data;
  assert.equal(snapshot.appointments.length, 3);
  assert.equal(snapshot.payments.length, 1);
  assert.equal(snapshot.ledger.length, 2);
  const deposit = snapshot.appointments.find(row => row.bookingMethod === 'DEPOSIT');
  assert.equal(deposit.depositAmount, '37.67');
  // All four roles use the same real notification endpoints and durable data.
  for (const excluded of booking.team.excluded) {
    assert.equal(snapshot.notifications.some(row => row.userId === excluded), false);
  }
  const customerCookie = cookie;
  const teamLists = [];
  for (const [email, password] of [
    ['owner@example.com', 'OwnerPassword123!'],
    ['manager@example.com', 'StrongPassword123!'],
    ['stylist@example.com', 'StrongPassword123!'],
  ]) {
    cookie = '';
    const signedIn = await api('/api/v1/auth/login', { method: 'POST', body: { email, password } });
    cookie = `accessToken=${signedIn.data.data.accessToken}`;
    if (email === 'owner@example.com' || email === 'manager@example.com') {
      const selected = (await api('/api/v1/banners', { method: 'POST', status: 201,
        body: { title: 'Branch launch', branchIds: [booking.branchId] } })).data.data;
      assert.equal(selected.status, 'DRAFT');
      assert.equal(selected.scope, 'SELECTED_BRANCHES');
      assert.deepEqual(selected.branchIds, [booking.branchId]);
      assert.deepEqual(selected.media, []);
      await api(`/api/v1/banners/${selected.id}/media`, { method: 'POST', status: 400,
        body: { objectKey: `banners/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`, mediaType: 'IMAGE' } });
      const missingBannerId = crypto.randomUUID();
      const missingBanner = await api(`/api/v1/banners/${missingBannerId}/media`, { method: 'POST', status: 404,
        body: { objectKey: `banners/${missingBannerId}/${crypto.randomUUID()}.jpg`, mediaType: 'IMAGE' } });
      assert.equal(missingBanner.data.message, 'BANNER_NOT_FOUND');
      const brandWide = await api('/api/v1/banners', { method: 'POST', status: email === 'owner@example.com' ? 201 : 403,
        body: { title: 'Brand launch', scope: 'BRAND_WIDE' } });
      if (email === 'owner@example.com') assert.equal(brandWide.data.data.scope, 'BRAND_WIDE');
    }
    const list = (await api('/api/v1/notifications')).data.data;
    const isStaff = email === 'stylist@example.com';
    const expectedTotal = isStaff ? 2 : 4;
    assert.equal(list.pagination.total, expectedTotal, `${email} receives only role-appropriate booking events`);
    assert.equal(list.items.some(row => row.type === 'BOOKING_CREATED'), !isStaff);
    assert.ok(list.items.some(row => row.type === 'BOOKING_CONFIRMED'));
    for (const row of list.items) assert.match(row.message, /Appointment /);
    const localized = (await api('/api/v1/notifications', { headers: { 'accept-language': 'zh-HK' } })).data.data;
    assert.match(localized.items[0].message, /預約/);
    const noteId = list.items[0].id;
    await api(`/api/v1/notifications/${noteId}/read`, { method: 'PATCH' });
    await api(`/api/v1/notifications/${noteId}/read`, { method: 'PATCH' });
    assert.equal((await api('/api/v1/notifications?unreadOnly=true')).data.data.pagination.total, expectedTotal - 1);
    await api('/api/v1/notifications/read-all', { method: 'PATCH' });
    assert.equal((await api('/api/v1/notifications?unreadOnly=true')).data.data.pagination.total, 0);
    teamLists.push(list.items.map(row => row.id));
  }
  assert.equal(new Set(teamLists.flat()).size, 10);
  for (const email of ['other-manager@example.com', 'other-staff@example.com']) {
    cookie = '';
    const signedIn = await api('/api/v1/auth/login', { method: 'POST', body: { email, password: 'StrongPassword123!' } });
    cookie = `accessToken=${signedIn.data.data.accessToken}`;
    assert.equal((await api('/api/v1/notifications')).data.data.pagination.total, 0);
  }
  cookie = customerCookie;
  assert.equal((await api('/api/v1/notifications?unreadOnly=true')).data.data.pagination.total, 2);
  await api(`/api/v1/notifications/${teamLists[0][0]}/read`, { method: 'PATCH', status: 403 });
  const reservedId = snapshot.appointments.find(row => row.bookingMethod === 'RESERVE_NOW').id;
  await api(`/api/v1/appointments/${reservedId}/reschedule`, { method: 'POST', body: { date: booking.date, startTime: '15:00', staffId: booking.team.otherStaffProfileId } });
  await api(`/api/v1/appointments/${reservedId}/cancel`, { method: 'POST', body: { reason: 'Test cancellation' } });
  const lifecycle = (await api('/__snapshot')).data.notifications;
  const rescheduled = lifecycle.filter(row => row.type === 'BOOKING_RESCHEDULED');
  assert.equal(rescheduled.length, 5);
  assert.ok(rescheduled.some(row => row.userId === booking.team.staffUserId));
  assert.ok(rescheduled.some(row => row.userId === booking.team.otherStaffUserId));
  const cancelled = lifecycle.filter(row => row.type === 'BOOKING_CANCELLED');
  assert.equal(cancelled.length, 4);
  assert.equal(cancelled.some(row => row.userId === booking.team.staffUserId), false);
  assert.ok(cancelled.some(row => row.userId === booking.team.otherStaffUserId));
  const beforeFailure = (await api('/__snapshot')).data;
  await api('/__notification-failure', { method: 'POST' });
  await api('/api/v1/appointments/reserve', { method: 'POST', body: { ...booking, startTime: '18:00' }, status: 500 });
  const afterFailure = (await api('/__snapshot')).data;
  assert.deepEqual(afterFailure, beforeFailure, 'Team persistence failure must roll back both the booking and all notifications');
  await api('/__notification-failure', { method: 'DELETE' });
  const raced = await Promise.all([1, 2].map(() => mf.dispatchFetch('https://test/api/v1/appointments/pay-now', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ...booking, startTime: '16:00' }),
  })));
  assert.equal(raced.filter(response => response.status === 201).length, 1);
  assert.ok(raced.some(response => response.status >= 400 && response.status < 500));
  const pending = await raced.find(response => response.status === 201).json();
  await api('/__expire', { method: 'POST', body: { id: pending.data.appointmentId } });
  const namespace = await mf.getDurableObjectNamespace('SALON_DB');
  const cron = await namespace.get(namespace.idFromName('salon-v1')).fetch('https://internal/__internal/cron');
  assert.equal(cron.status, 200);
  const expired = (await api('/__snapshot')).data.appointments.find(row => row.id === pending.data.appointmentId);
  assert.equal(expired.appointmentStatus, 'EXPIRED');
  assert.equal(expired.paymentStatus, 'FAILED');
  const expiryNotes = (await api('/__snapshot')).data.notifications.filter(row => row.type === 'BOOKING_EXPIRED');
  assert.equal(expiryNotes.length, 3, 'Customer, manager and owner receive expiry; staff does not');
  assert.equal(expiryNotes.some(row => row.userId === booking.team.staffUserId), false);
  await namespace.get(namespace.idFromName('salon-v1')).fetch('https://internal/__internal/cron');
  assert.equal((await api('/__snapshot')).data.notifications.filter(row => row.type === 'BOOKING_EXPIRED').length, 3);
  const upcoming = (await api('/__snapshot')).data.appointments.find(row => row.appointmentStatus === 'CONFIRMED');
  assert.ok(upcoming);
  const start = new Date(`${upcoming.date.slice(0, 10)}T${upcoming.startTime}:00+08:00`).getTime();
  const runReminders = now => api('/__reminders', { method: 'POST', body: { now: new Date(now).toISOString() } });
  assert.equal((await runReminders(start - 61 * 60000)).data.reminderCount, 0);
  assert.ok((await runReminders(start - 30 * 60000)).data.reminderCount >= 1);
  assert.equal((await runReminders(start - 29 * 60000)).data.reminderCount, 0);
  assert.equal((await runReminders(start + 60000)).data.reminderCount, 0);
  const reminders = (await api('/__snapshot')).data.notifications.filter(row => row.type === 'APPOINTMENT_REMINDER');
  assert.ok(reminders.every(row => row.userId === upcoming.customerId));

  assert.equal((await mf.dispatchFetch('https://test/__internal/cron')).status, 404);
  const rotated = await api('/api/v1/auth/refresh-token', { method: 'POST', body: {} });
  assert.notEqual(rotated.data.data.newRefreshToken, refresh);
  await api('/api/v1/auth/refresh-token', { method: 'POST', body: {}, status: 401 });
  const merchantControl = body => api('/__email-test-control', { method:'POST', body });
  const merchantBrand = (await merchantControl({})).data.brandId;
  const merchantOwner = (await api('/api/v1/auth/login', {method:'POST',body:{email:'owner@example.com',password:'OwnerPassword123!'}})).data.data.accessToken;
  const merchantRoot = '/api/v1/brand-email-settings/'+merchantBrand;
  const merchantHeaders = {authorization:`Bearer ${merchantOwner}`,cookie:''};
  await api(merchantRoot,{method:'PUT',headers:merchantHeaders,body:{provider:'GMAIL',fromName:'Synthetic merchant',fromEmail:'salon@gmail.com',smtpUsername:'salon@gmail.com',password:'abcdefghijklmnop'}});
  await api(merchantRoot+'/test-email',{method:'POST',headers:merchantHeaders,body:{recipientEmail:'synthetic@example.com'}});
  await api(merchantRoot+'/enable',{method:'PATCH',headers:merchantHeaders});
  await api('/api/v1/auth/forgot-password', { method: 'POST', body: { email: credentials.email } });
  const outbox = (await api('/__outbox')).data;
  assert.equal(outbox.length, 0, 'No platform transport is used');
  await api('/api/v1/auth/forgot-password', { method: 'POST', body: { email: credentials.email }, status: 429 });
  const otp = (await merchantControl({authEmail:credentials.email})).data.auth.otp;
  assert.match(otp,/^\d{6}$/);
  const verified = await api('/api/v1/auth/verify-reset-otp', { method: 'POST', body: { email: credentials.email, otp } });
  const resetToken = verified.data.data.resetToken;
  const newPassword = 'DifferentPassword123!';
  await api('/api/v1/auth/reset-password', { method: 'POST', body: { resetToken, newPassword } });
  await api('/api/v1/auth/reset-password', { method: 'POST', body: { resetToken, newPassword }, status: 400 });
  cookie = `refreshToken=${rotated.data.data.newRefreshToken}`;
  await api('/api/v1/auth/refresh-token', { method: 'POST', body: {}, status: 401 });
  await api('/api/v1/auth/login', { method: 'POST', body: credentials, status: 401 });
  await api('/api/v1/auth/login', { method: 'POST', body: { ...credentials, password: newPassword } });
  const groupSafety = await api('/__group-safety');
  assert.ok(groupSafety.data.passed.length >= 50);
  t.diagnostic(`Unified Group Purchase: ${groupSafety.data.passed.length} real SQLite service checks passed`);

  const completionCases = (await api('/__completion-test', { method: 'POST', body: { prepare: true } })).data;
  const completionIds = Object.values(completionCases);
  const completionState = async clearFailure => (await api('/__completion-test', {
    method: 'POST', body: { ids: completionIds, clearFailure },
  })).data;
  const runCron = () => namespace.get(namespace.idFromName('salon-v1')).fetch('https://internal/__internal/cron');
  const concurrentCrons = await Promise.all([runCron(), runCron()]);
  for (const response of concurrentCrons) assert.equal(response.status, 200, await response.text());
  const completedState = await completionState(false);
  for (const name of ['payNow', 'reserve', 'deposit']) {
    const row = completedState.appointments.find(row => row.id === completionCases[name]);
    assert.equal(row.appointmentStatus, 'COMPLETED', name);
    assert.ok(row.completedAt);
    assert.equal(completedState.notifications.filter(note => note.appointmentId === row.id).length, 1);
    const audit = completedState.audits.filter(audit => audit.entityId === row.id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].userId, null);
    assert.equal(audit[0].metadata.performedBy, 'SYSTEM');
  }
  for (const name of ['rollback', 'unverified', 'tooEarly', 'unpaid', 'cancelled', 'zeroDuration']) {
    const row = completedState.appointments.find(row => row.id === completionCases[name]);
    assert.equal(row.appointmentStatus, name === 'cancelled' ? 'CANCELLED' : 'CONFIRMED', name);
    assert.equal(row.completedAt, null);
    assert.equal(completedState.notifications.some(note => note.appointmentId === row.id), false);
    assert.equal(completedState.audits.some(audit => audit.entityId === row.id), false);
  }
  await completionState(true);
  assert.equal((await runCron()).status, 200);
  const recoveredState = await completionState(false);
  assert.equal(recoveredState.appointments.find(row => row.id === completionCases.rollback).appointmentStatus, 'COMPLETED');
  assert.equal(recoveredState.notifications.length, 4);
  assert.equal(recoveredState.audits.length, 4);
  assert.equal((await runCron()).status, 200);
  assert.deepEqual(await completionState(false), recoveredState);

});
