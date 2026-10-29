import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHmac } from 'node:crypto';
const require = createRequire(path.resolve('node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
import { setup } from './test-support/public-worker.mjs';

for (const flag of [undefined, 'false']) test(`Book Now public creation is disabled for flag=${flag ?? 'missing'}`, async t => {
  const { api, fixture, state } = await setup(t, flag);
  const before = await state();
  const result = await api('/api/v1/group-purchases', { body: { ...fixture, quantity: 2, purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'PAY_NOW', startTime: '10:00' }, status: 422 });
  assert.match(result.message, /not enabled/);
  assert.deepEqual(await state(), before);
  const options = (await api(`/api/v1/packages/${fixture.packageId}`)).data.groupPurchaseOptions;
  assert.deepEqual(options.availablePurchaseFlows, ['BUY_NOW_BOOK_LATER']);
  await api('/api/v1/group-purchases', { body: { packageId: fixture.packageId, quantity: 1 }, status: 201 });
});

test('enabled public Book Now creation, Stripe, wallet, QR, salon and expiry end to end', async t => {
  const { api, ownerToken, managerToken, otherManagerToken, fixture, state, webhook, cron } = await setup(t, 'true');
  const root = '/api/v1/group-purchases';
  await t.test('policy management routes persist and version JSON on the Cloudflare schema', async () => {
    const packagePath = `/api/v1/branches/${fixture.branchId}/group-purchase-refund-policy`;
    const refundPolicy = { isEnabled: true, refundAllowed: true, refundTiers: [{ minimumHoursAfterPurchase: 0, calculationType: 'PERCENTAGE', value: 100 }], allowPartiallyUsedRefund: false, allowExpiredRefund: false, requireNoActiveAppointments: true };
    await api(packagePath, { method: 'PUT', body: refundPolicy, status: 403 });
    const first = (await api(packagePath, { method: 'PUT', body: refundPolicy, roleToken: ownerToken })).data;
    assert.equal(first.version, 1);
    const second = (await api(packagePath, { method: 'PUT', body: refundPolicy, roleToken: ownerToken })).data;
    assert.equal(second.version, 2);
    assert.equal(second.branchId, fixture.branchId);
    await api(packagePath, { roleToken: otherManagerToken, status: 403 });
    await api(packagePath, { method: 'PUT', body: refundPolicy, roleToken: otherManagerToken, status: 403 });
    assert.equal((await api(packagePath, { method: 'PUT', body: refundPolicy, roleToken: managerToken })).data.version, 3);
    assert.deepEqual((await api(packagePath, { roleToken: ownerToken })).data.refundTiers, refundPolicy.refundTiers);
    const branchPath = `/api/v1/branches/${fixture.branchId}/cancellation-policy`;
    const cancellationPolicy = { isEnabled: true, cancellationAllowed: true, minimumCancellationHours: 2, nonRefundable: false, refundTiers: [{ minimumHoursBefore: 2, calculationType: 'PERCENTAGE', value: 50 }] };
    await api(branchPath, { method: 'PUT', body: cancellationPolicy, roleToken: otherManagerToken, status: 403 });
    assert.equal((await api(branchPath, { method: 'PUT', body: cancellationPolicy, roleToken: managerToken })).data.version, 1);
    assert.equal((await api(branchPath, { method: 'PUT', body: cancellationPolicy, roleToken: ownerToken })).data.version, 2);
    assert.deepEqual((await api(branchPath)).data.refundTiers, cancellationPolicy.refundTiers);
    const groupCancellationPath = `/api/v1/branches/${fixture.branchId}/group-purchase-cancellation-policy`;
    const groupCancellation = {isEnabled:true,cancellationAllowed:true,minimumCancellationHours:2,restorationMinimumHours:24,lateCancellationOutcome:'RESTORED'};
    await api(groupCancellationPath, {method:'PUT',body:groupCancellation,status:403});
    await api(groupCancellationPath, {method:'PUT',body:groupCancellation,roleToken:otherManagerToken,status:403});
    assert.equal((await api(groupCancellationPath,{method:'PUT',body:groupCancellation,roleToken:managerToken})).data.version,1);
    assert.equal((await api(groupCancellationPath,{method:'PUT',body:groupCancellation,roleToken:ownerToken})).data.version,2);
    assert.equal((await api(groupCancellationPath,{roleToken:managerToken})).data.lateCancellationOutcome,'RESTORED');
    await api(groupCancellationPath,{roleToken:otherManagerToken,status:403});
  });
  await t.test('frontend discovery exposes two modes and effective branch methods', async () => {
    const options = (await api(`/api/v1/packages/${fixture.packageId}`)).data.groupPurchaseOptions;
    assert.deepEqual(options.availablePurchaseFlows, ['BUY_NOW_BOOK_LATER', 'DIRECT_BOOK']);
    assert.equal(options.staffSelectionRequired, false);
    const policy = (await api(`/api/v1/branches/${fixture.branchId}/booking-policy`)).data;
    assert.deepEqual(policy.groupPurchaseBookingMethods, ['PAY_NOW', 'DEPOSIT', 'RESERVE_NOW']);
    assert.equal(policy.depositPercentage, 30);
  });
  await t.test('validation and amount tampering cannot bypass rules', async () => {
    await api(root, { body: { packageId: fixture.packageId, quantity: 1, purchaseFlow: 'DIRECT_BOOK' }, status: 400 });
    await api(root, { body: { ...fixture, quantity: 0, purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'PAY_NOW', startTime: '08:00' }, status: 400 });
  });
  let index = 0;
  for (const [method, provider] of [['PAY_NOW', 'STRIPE'], ['DEPOSIT', 'STRIPE'], ['PAY_NOW', 'WALLET'], ['DEPOSIT', 'WALLET'], ['RESERVE_NOW', 'SALON']]) {
    const startTime = `${String(8 + index++ * 2).padStart(2, '0')}:00`;
    await t.test(`${method} via ${provider}: public purchase to full payment`, async () => {
      const before = await state();
      const created = (await api(root, { body: { ...fixture, quantity: 2, purchaseFlow: 'DIRECT_BOOK', bookingMethod: method, startTime, amount: 1, depositAmount: 1 }, status: 201 })).data;
      const id = created.purchaseId; const appointmentId = created.firstAppointment.appointmentId;
      assert.equal(created.amount, 200.5);
      assert.equal(created.depositAmount, method === 'DEPOSIT' ? 60.15 : null);
      assert.equal(created.paymentStatus, method === 'RESERVE_NOW' ? 'UNPAID' : 'PENDING');
      assert.equal(created.reservationExpiresAt === null, method === 'RESERVE_NOW');
      const pendingDetail = (await api(`${root}/${id}`)).data;
      assert.equal(pendingDetail.purchaseFlow, 'DIRECT_BOOK');
      assert.equal(pendingDetail.bookingMethod, method);
      assert.equal(pendingDetail.firstAppointment.appointmentId, appointmentId);
      await api(`${root}/${id}`, { roleToken: managerToken });
      await api(`${root}/${id}`, { roleToken: otherManagerToken, status: 403 });
      assert.equal(pendingDetail.onlinePaymentRequired, method !== 'RESERVE_NOW');
      assert.equal(pendingDetail.amountDueOnline, method === 'DEPOSIT' ? 60.15 : method === 'PAY_NOW' ? 200.5 : 0);
      await api(`/api/v1/appointments/${appointmentId}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
      await api('/api/v1/payments/stripe/create-intent', { body: { appointmentId }, status: 409 });
      await api(`/api/v1/appointments/${appointmentId}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken, status: 409 });
      await api(`${root}/${id}/book-appointment`, { body: { branchId: fixture.branchId, date: fixture.date, startTime: '21:00' }, status: 409 });
      if (provider === 'STRIPE') {
        const concurrentIntents = await Promise.all([1, 2].map(() => api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 201 })));
        assert.equal(concurrentIntents[0].data.paymentId, concurrentIntents[1].data.paymentId);
        assert.equal(concurrentIntents[0].data.clientSecret, concurrentIntents[1].data.clientSecret);
        const intent = concurrentIntents[0].data;
        assert.equal(intent.amount, method === 'DEPOSIT' ? 60.15 : 200.5);
        const repeat = (await api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 201 })).data;
        assert.equal(repeat.paymentId, intent.paymentId); assert.equal(repeat.clientSecret, intent.clientSecret);
        await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
        const event = await api('/__book-now-provider', { body: { paymentId: intent.paymentId } });
        await webhook(event); const paidState = await state(); await webhook(event);
        await webhook({ ...event, id: `${event.id}_replay` });
        const replayState = await state();
        assert.deepEqual(replayState.wallets, paidState.wallets);
        assert.equal(replayState.notifications.length, paidState.notifications.length);
      } else if (provider === 'WALLET') {
        const paid = (await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true } })).data;
        assert.equal(paid.amountPaid, method === 'DEPOSIT' ? 60.15 : 200.5);
        const after = await state();
        assert.equal(Math.round(Number(before.wallets[0].paidBalance) * 100) + Math.round(Number(before.wallets[0].bonusBalance) * 100) - Math.round(Number(after.wallets[0].paidBalance) * 100) - Math.round(Number(after.wallets[0].bonusBalance) * 100), Math.round(paid.amountPaid * 100));
        await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
        assert.deepEqual((await state()).wallets, after.wallets);
      } else {
        await api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: id }, status: 422 });
        await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true }, status: 422 });
      }
      let current = await state(); let purchase = current.purchases.find(row => row.id === id); let appointment = current.appointments.find(row => row.id === appointmentId);
      assert.equal(appointment.appointmentStatus, method === 'PAY_NOW' ? 'CONFIRMED' : 'RESERVED');
      assert.equal(appointment.paymentStatus, method === 'PAY_NOW' ? 'PAID' : method === 'DEPOSIT' ? 'PARTIALLY_PAID' : 'UNPAID');
      assert.equal(!!appointment.qrToken, true);
      await api(`/api/v1/appointments/${appointmentId}/cancel`, { body: { reason: 'Test cancellation' }, status: 409 });
      if (method !== 'PAY_NOW') {
        await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken, status: 409 });
        await api(`/api/v1/appointments/${appointmentId}/qr`);
        await api('/api/v1/appointments/verify-qr', { body: { qrToken: appointment.qrToken, branchId: fixture.branchId }, roleToken: ownerToken });
        assert.equal((await api(`${root}/${id}`)).data.qrVerificationRequired, false);
        await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, status: 403 });
        const remaining = await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken });
        assert.equal(remaining.success, true);
        current = await state(); purchase = current.purchases.find(row => row.id === id);
        const salon = current.payments.find(row => row.groupPurchaseId === id && row.provider === 'SALON');
        assert.equal(Number(salon.amount), method === 'DEPOSIT' ? 140.35 : 200.5);
        await api(`${root}/${id}/remaining-payment`, { body: { paymentMethod: 'CASH' }, roleToken: ownerToken, status: 409 });
      }
      assert.equal(purchase.paymentStatus, 'PAID');
      const settled = (await api(`${root}/${id}`)).data;
      assert.equal(settled.amountDueOnline, 0);
      assert.equal(settled.amountDueAtSalon, 0);
      assert.equal(settled.redemption.remainingQuantity, 1);
      const listed = (await api(`${root}/my`)).data.items.find(item => item.id === id);
      assert.equal(listed.bookingMethod, method);
      assert.equal(listed.firstAppointment.appointmentId, appointmentId);
      const inventory = (await state()).packages.find(row => row.id === fixture.packageId);
      assert.equal(inventory.soldQuantity, index * 2); assert.equal(inventory.reservedQuantity, 0);
      const emails = (await api('/__business-email-test', {body:{}})).jobs;
      const successEmails = emails.filter(j => j.eventType === 'GROUP_PURCHASE_SUCCESSFUL' && j.idempotencyKey.endsWith(`:${id}`));
      assert.equal(successEmails.length, 0, 'Business APIs do not synchronously write email jobs; reconciliation runs separately');
      assert.equal(emails.filter(j => j.appointmentId === appointmentId && j.eventType === 'RESERVE_NOW_RESERVED').length, 0);
      assert.equal(emails.filter(j => j.appointmentId === appointmentId && ['PAY_NOW_CONFIRMED','DEPOSIT_RECEIVED'].includes(j.eventType)).length, 0, 'Group settlement does not create duplicate ordinary appointment receipts');
    });
  }
  await t.test('initial entitlement counts and redemption cannot exceed quantity', async () => {
    const purchase = (await state()).purchases[0];
    await api(`${root}/${purchase.id}/book-appointment`, { body: { branchId: fixture.branchId, date: fixture.date, startTime: '19:00' }, status: 201 });
    await api(`${root}/${purchase.id}/book-appointment`, { body: { branchId: fixture.branchId, date: fixture.date, startTime: '20:00' }, status: 409 });
  });
  await t.test('public pending purchase expires once and late signed success refunds once', async () => {
    const created = (await api(root, { body: { ...fixture, quantity: 2, purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'PAY_NOW', startTime: '18:00' }, status: 201 })).data;
    const intent = (await api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: created.purchaseId }, status: 201 })).data;
    await api('/__book-now-expire', { body: { purchaseId: created.purchaseId } });
    await cron(); await cron();
    let current = await state();
    assert.equal(current.purchases.find(row => row.id === created.purchaseId).paymentStatus, 'FAILED');
    assert.equal(current.appointments.find(row => row.id === created.firstAppointment.appointmentId).appointmentStatus, 'EXPIRED');
    const inventory = current.packages[0];
    const event = await api('/__book-now-provider', { body: { paymentId: intent.paymentId } });
    await webhook(event); await webhook({ ...event, id: `${event.id}_retry` });
    current = await state();
    assert.equal(current.payments.find(row => row.id === intent.paymentId).status, 'REFUNDED');
    assert.equal(current.refunds.filter(row => row.paymentId === intent.paymentId).length, 1);
    assert.deepEqual(current.packages[0], inventory);
  });
});

test('Buy Later and policy-driven Direct Booking public regressions', async t => {
  const { api, fixture, state, webhook } = await setup(t, 'true');
  const root = '/api/v1/group-purchases';
  const policy = data => api('/__book-now-policy', { body: { branchId: fixture.branchId, data } });
  const direct = (bookingMethod, startTime = '10:00') => ({ ...fixture, quantity: 2, purchaseFlow: 'DIRECT_BOOK', bookingMethod, startTime });
  await t.test('disabled methods, absent deposit, invalid deposit and notice/advance rules have no side effects', async () => {
    const before = await state();
    await policy({ allowedBookingMethods: ['PAY_NOW'] });
    await api(root, { body: direct('DEPOSIT'), status: 422 });
    assert.deepEqual((await api(`/api/v1/branches/${fixture.branchId}/booking-policy`)).data.groupPurchaseBookingMethods, ['PAY_NOW']);
    await policy({ allowedBookingMethods: ['PAY_NOW', 'DEPOSIT', 'RESERVE_NOW'], depositEnabled: false });
    await api(root, { body: direct('DEPOSIT'), status: 422 });
    await policy({ depositEnabled: true, depositPercentage: null });
    await api(root, { body: direct('DEPOSIT'), status: 422 });
    assert.equal((await api(`/api/v1/branches/${fixture.branchId}/booking-policy`)).data.depositPercentage, null);
    await policy({ depositPercentage: 100 });
    await api(root, { body: direct('DEPOSIT'), status: 422 });
    await policy({ depositPercentage: 25, maximumAdvanceBookingDays: 1 });
    await api(root, { body: direct('PAY_NOW'), status: 409 });
    await policy({ maximumAdvanceBookingDays: 30, minimumBookingNoticeMinutes: 10000 });
    await api(root, { body: direct('PAY_NOW'), status: 409 });
    await policy({ minimumBookingNoticeMinutes: 0 });
    await api(root, { body: direct('PAY_NOW', '23:50'), status: 409 });
    assert.deepEqual(await state(), before);
  });
  await t.test('configured deposit and automatic staff selection are used, conflicting concurrent bookings cannot both succeed', async () => {
    const body = direct('DEPOSIT'); delete body.staffId;
    const created = (await api(root, { body, status: 201 })).data;
    assert.equal(created.depositPercentage, 25); assert.equal(created.depositAmount, 50.13);
    assert.equal(created.remainingAmount, 150.37); assert.equal(created.firstAppointment.staffId, fixture.staffId);
    await api(root, { body, status: 409 });
    // Contending for a different single-staff slot: one purchase/appointment wins.
    const attempts = await Promise.allSettled([1, 2].map(() => api(root, { body: direct('PAY_NOW', '11:00'), status: 201 })));
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal((await state()).appointments.filter(item => item.startTime === '11:00').length, 1);
  });
  await t.test('Buy Later full wallet payment unlocks exactly the purchased quantity', async () => {
    const created = (await api(root, { body: { packageId: fixture.packageId, quantity: 1, purchaseFlow: 'BUY_NOW_BOOK_LATER' }, status: 201 })).data;
    const id = created.purchaseId;
    assert.equal(created.firstAppointment, null); assert.equal(created.amountDueOnline, 100.25);
    const redeem = time => ({ branchId: fixture.branchId, date: fixture.date, startTime: time });
    await api(`${root}/${id}/book-appointment`, { body: redeem('12:00'), status: 409 });
    const paid = (await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true } })).data;
    assert.equal(paid.amountPaid, 100.25);
    await api(`${root}/${id}/pay-with-wallet`, { body: { useBonus: true }, status: 409 });
    await api(`${root}/${id}/book-appointment`, { body: redeem('12:00'), status: 201 });
    await api(`${root}/${id}/book-appointment`, { body: redeem('13:00'), status: 409 });
    const detail = (await api(`${root}/${id}`)).data;
    assert.equal(detail.firstAppointment, null); assert.equal(detail.redemption.remainingQuantity, 0);
    assert.equal(detail.redemption.canBookAppointment, false);
  });
  await t.test('Buy Later Stripe settles the full purchase once through signed webhooks', async () => {
    const created = (await api(root, { body: { packageId: fixture.packageId, quantity: 2 }, status: 201 })).data;
    const intent = (await api('/api/v1/payments/group-purchase/create-intent', { body: { purchaseId: created.purchaseId }, status: 201 })).data;
    assert.equal(intent.amount, 200.5);
    const event = await api('/__book-now-provider', { body: { paymentId: intent.paymentId } });
    await webhook(event); const before = await state(); await webhook({ ...event, id: `${event.id}_duplicate` });
    assert.deepEqual(await state(), before);
    const detail = (await api(`${root}/${created.purchaseId}`)).data;
    assert.equal(detail.paymentStatus, 'PAID'); assert.equal(detail.firstAppointment, null);
    assert.equal(detail.redemption.remainingQuantity, 2); assert.equal(detail.redemption.canBookAppointment, true);
  });
  await t.test('concurrent wallet requests debit a Direct Booking only once', async () => {
    const created = (await api(root, { body: { ...direct('PAY_NOW', '14:00'), quantity: 1 }, status: 201 })).data;
    const before = await state();
    const attempts = await Promise.allSettled([1, 2].map(() => api(`${root}/${created.purchaseId}/pay-with-wallet`, { body: { useBonus: true } })));
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    const after = await state();
    const balance = row => Math.round(Number(row.paidBalance) * 100) + Math.round(Number(row.bonusBalance) * 100);
    assert.equal(balance(before.wallets[0]) - balance(after.wallets[0]), 10025);
    assert.equal(after.payments.filter(item => item.groupPurchaseId === created.purchaseId && item.status === 'PAID').length, 1);
  });
});


test('AUTO concurrent reservations avoid double-booking and holds block slots without counting as workload',async t=>{
 const {api,fixture}=await setup(t,'true');
 await api('/__policy-test',{body:{autoStaff:fixture}});
 const book=(method,time,status=201)=>api(`/api/v1/appointments/${method}`,{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,date:fixture.date,startTime:time},status});
 const reserved=await Promise.all([book('reserve','10:00'),book('reserve','10:00')]);
 let rows=(await api('/__snapshot')).appointments;
 const reservationIds=reserved.map(r=>r.data.appointmentId);
 const selected=rows.filter(r=>reservationIds.includes(r.id));assert.equal(new Set(selected.map(r=>r.staffId)).size,2);
 const held=await book('pay-now','10:00');const heldId=held.data.appointmentId;
 rows=(await api('/__snapshot')).appointments;const hold=rows.find(r=>r.id===heldId);
 assert.ok(!selected.some(r=>r.staffId===hold.staffId));assert.equal(hold.appointmentStatus,'PENDING_PAYMENT');
 await book('reserve','10:00',409);
 const next=await book('reserve','11:00');rows=(await api('/__snapshot')).appointments;
 assert.equal(rows.find(r=>r.id===next.data.appointmentId).staffId,hold.staffId,'Pending hold has zero fairness weight at non-overlapping time');
 for(const appointment of selected){
  await api('/api/v1/appointments/reserve',{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,date:fixture.date,startTime:'12:00',staffId:appointment.staffId},status:201});
 }
 await api(`/api/v1/appointments/${selected[0].id}/reschedule`,{body:{date:fixture.date,startTime:'13:00'}});
 rows=(await api('/__snapshot')).appointments;
 assert.equal(rows.find(r=>r.id===selected[0].id).staffId,hold.staffId,'AUTO reschedule selects the daily minimum within its transaction');
 const purchase=(await api('/api/v1/group-purchases',{body:{packageId:fixture.packageId,quantity:1,purchaseFlow:'BUY_NOW_BOOK_LATER'},status:201})).data;
 await api(`/api/v1/group-purchases/${purchase.purchaseId}/pay-with-wallet`,{body:{useBonus:true}});
 await api(`/api/v1/group-purchases/${purchase.purchaseId}/book-appointment`,{body:{branchId:fixture.branchId,date:fixture.date,startTime:'14:00'},status:201});
 rows=(await api('/__snapshot')).appointments;
 assert.equal(rows.find(r=>r.groupPurchaseId===purchase.purchaseId).staffId,selected[0].staffId,'AUTO package redemption counts all daily service bookings');
 for(const staffId of new Set(rows.map(r=>r.staffId))){
  const appointments=rows.filter(r=>r.staffId===staffId&&r.appointmentStatus!=='CANCELLED').sort((a,b)=>a.startTime.localeCompare(b.startTime));
  for(let i=1;i<appointments.length;i++)assert.ok(appointments[i-1].endTime<=appointments[i].startTime,'No overlapping staff assignment');
 }
});

test('45-minute AUTO availability preview stays bookable with a different fair staff on real Worker SQLite', async t => {
 const { api, fixture } = await setup(t, 'true');
 await api('/__policy-test', { body: { autoStaff: { ...fixture, durationMinutes: 45, maxBookingsPerHour: 4 } } });
 const query = new URLSearchParams({ branchId: fixture.branchId, serviceId: fixture.serviceId, date: fixture.date, staff: 'ANY' });
 const readSlot = async () => (await api(`/api/v1/availability?${query}`)).data.slots.find(slot => slot.startTime === '15:00');
 const preview = await readSlot();
 assert.equal(preview.endTime, '15:45'); assert.equal(preview.available, true);
 assert.deepEqual(preview.capacity, { maxBookingsPerHour: 4, used: 0, remaining: 4 });
 const body = { branchId: fixture.branchId, serviceId: fixture.serviceId, date: fixture.date, startTime: '15:00', bookingMethod: 'RESERVE_NOW' };
 // Give the preview staff a non-overlapping booking so the daily minimum is elsewhere.
 await api('/api/v1/appointments/reserve', { body: { ...body, startTime: '13:00', staffId: preview.staffId }, status: 201 });
 assert.equal((await readSlot()).staffId, preview.staffId);
 const created = await api('/api/v1/appointments/reserve', { body, status: 201 });
 const detail = (await api(`/api/v1/appointments/${created.data.appointmentId}`)).data;
 assert.notEqual(detail.staff.id, preview.staffId);
 assert.equal(detail.startTime, '15:00'); assert.equal(detail.endTime, '15:45');
 // Manual assignment remains available for the other, non-conflicting staff.
 await api('/api/v1/appointments/reserve', { body: { ...body, staffId: preview.staffId }, status: 201 });
});
