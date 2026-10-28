import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

test('remaining payment APIs on Cloudflare: normal/group deposits via wallet and Stripe', async t => {
  const { api, fixture, ownerToken, state, webhook } = await setup(t, 'true');
  const customer = (await state()).wallets[0].customerId;
  for (const group of [false, true]) for (const provider of ['wallet', 'stripe']) {
    await t.test(`${group ? 'Group purchase' : 'Appointment'} remaining via ${provider}`, async () => {
      let appointmentId, purchaseId;
      if (group) {
        const created = (await api('/api/v1/group-purchases', { status: 201, body: {
          ...fixture, quantity: 2, purchaseFlow: 'DIRECT_BOOK', bookingMethod: 'DEPOSIT', startTime: provider === 'wallet' ? '20:00' : '22:00',
        } })).data;
        purchaseId = created.purchaseId;
        appointmentId = created.firstAppointment.appointmentId;
        await api(`/api/v1/group-purchases/${purchaseId}/pay-with-wallet`, { body: { useBonus: false } });
        const appointment = (await state()).appointments.find(row => row.id === appointmentId);
        await api('/api/v1/appointments/verify-qr', { body: { qrToken: appointment.qrToken, branchId: fixture.branchId }, roleToken: ownerToken });
      } else {
        ({ appointmentId } = await api('/__policy-test', { body: { remainingDeposit: { ...fixture, customerId: customer } } }));
      }
      const resource = group ? `group-purchases/${purchaseId}` : `appointments/${appointmentId}`;
      const url = provider === 'stripe'
        ? `/api/v1/payments/${resource}/remaining-payment/stripe`
        : group ? `/api/v1/wallet/group-purchases/${purchaseId}/remaining-payment/wallet`
          : `/api/v1/wallet/${appointmentId}/remaining-payment/wallet`;
      await api(url, { method: 'POST', body: {}, roleToken: '', status: 401 });
      await api(url, { method: 'POST', body: {}, roleToken: ownerToken, status: 403 });
      const before = await state();
      const result = (await api(url, { body: provider === 'wallet' ? { useBonus: false } : {} })).data;
      if (provider === 'stripe') {
        const repeat = (await api(url, { body: {} })).data;
        assert.equal(repeat.paymentId, result.paymentId);
        const event = await api('/__book-now-provider', { body: { paymentId: result.paymentId } });
        await webhook(event);
        const settled = await state();
        await webhook(event);
        await webhook({ ...event, id: `${event.id}_replay` });
        assert.deepEqual(await state(), settled);
      }
      const after = await state();
      const payment = after.payments.find(row => row.id === result.paymentId);
      assert.equal(payment.status, 'PAID');
      assert.equal(Number(payment.amount), group ? 140.35 : 210);
      assert.equal(after.appointments.find(row => row.id === appointmentId).paymentStatus, 'PAID');
      if (group) assert.equal(after.purchases.find(row => row.id === purchaseId).paymentStatus, 'PAID');
      if (provider === 'wallet') {
        const oldWallet = before.wallets.find(row => row.customerId === customer);
        const newWallet = after.wallets.find(row => row.customerId === customer);
        assert.equal(Math.round((Number(oldWallet.paidBalance) - Number(newWallet.paidBalance)) * 100), group ? 14035 : 21000);
      }
      await api(url, { body: provider === 'wallet' ? { useBonus: false } : {}, status: 409 });
      assert.deepEqual(await state(), after);
    });
  }
});
