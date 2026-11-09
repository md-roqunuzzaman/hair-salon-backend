import assert from 'node:assert/strict';
import test from 'node:test';
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', REDIS_URL: 'redis://127.0.0.1:1', JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3) });
const { reportingCurrency, assertReportingCurrency } = await import('../src/app/utils/report-currency.utils.ts');
function fixture() {
  const state = { currency: 'HKD', payments: ['HKD'], wallets: ['HKD'], appointments: ['HKD'], purchases: ['HKD'], unknown: 0 };
  const group = key => ({ groupBy: async () => state[key].map(currency => ({ currency })) });
  const client = { brand: { findFirst: async () => ({ currency: state.currency, timezone: 'Asia/Hong_Kong', countryCode: 'HK' }) }, payment: group('payments'), wallet: group('wallets'), appointment: group('appointments'), groupPurchase: { ...group('purchases'), count: async () => state.unknown } };
  return { state, client };
}
test('homogeneous reports retain original denomination without changing source amounts', async () => {
  const { state, client } = fixture(), before = structuredClone(state);
  assert.equal(await reportingCurrency(client), 'HKD');
  await assertReportingCurrency('HKD', client);
  assert.deepEqual(state, before);
});
test('reports reject mixed currencies instead of adding them', async () => {
  const { state, client } = fixture(); state.payments.push('GBP');
  await assert.rejects(reportingCurrency(client), /Mixed-currency/);
});
test('required purchase snapshots reject missing currency even when legacy linked evidence exists', async () => {
  const { state, client } = fixture(); state.purchases = [null]; state.unknown = 1;
  await assert.rejects(reportingCurrency(client), /reconciliation/);
  state.unknown = 0;
  await assert.rejects(reportingCurrency(client), /reconciliation/);
  state.purchases = ['HKD'];
  assert.equal(await reportingCurrency(client), 'HKD');
});

test('all required financial currencies reject null or empty storage values', async () => {
  for (const bucket of ['payments','wallets','appointments','purchases']) {
    for (const invalid of [null,'']) {
      const { state, client } = fixture(); state[bucket] = [invalid];
      await assert.rejects(reportingCurrency(client), /reconciliation/);
    }
  }
});
test('final currency fence detects initial settings changed during report calculation', async () => {
  const { state, client } = fixture(); state.payments = []; state.wallets = []; state.appointments = []; state.purchases = [];
  const initial = await reportingCurrency(client);
  state.currency = 'GBP';
  await assert.rejects(assertReportingCurrency(initial, client), /currency changed/);
});
