import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';
import { featureLicenseConfig } from '../src/app/config/feature-license.config.ts';

test('Worker branch creation preserves defaults, duplicate checks and concurrent branch limit', async t => {
  const ctx = await setup(t, 'true');
  const { brand } = await ctx.direct('/__branch-brand-test', { ownerCheck: true, assignOwner: true });
  const limit = featureLicenseConfig.features.BRANCH_STORE.branchLimit;
  const count = async () => (await ctx.direct('/__branch-brand-test', { count: true })).count;
  const before = await count();
  assert.ok(before < limit, 'isolated fixture must have room for a branch');
  const body = { brandId: brand.id, name: 'Cloudflare branch lock regression', address: 'Synthetic Hong Kong branch address' };
  const created = (await ctx.api('/api/v1/branches', { body, roleToken: ctx.ownerToken, status: 201 })).data;
  assert.ok(created.id);
  assert.equal(await count(), before + 1);
  const policy = (await ctx.api(`/api/v1/branches/${created.id}/booking-policy`)).data;
  assert.equal(policy.slotIntervalMinutes, 30);
  assert.equal(policy.depositPercentage, 10);
  assert.deepEqual(policy.allowedBookingMethods, ['PAY_NOW', 'DEPOSIT', 'RESERVE_NOW']);
  const capacity = (await ctx.api(`/api/v1/branches/${created.id}/hourly-capacity`, { roleToken: ctx.ownerToken })).data;
  assert.equal(capacity.capacities.length, 7);
  assert.ok(capacity.capacities.every(row => row.maxBookingsPerHour === 4));
  await ctx.api('/api/v1/branches', { body: { ...body, name: body.name.toUpperCase() }, roleToken: ctx.ownerToken, status: 409 });
  assert.equal(await count(), before + 1);

  const remaining = limit - await count();
  const post = name => ctx.fetch('https://test/api/v1/branches', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.ownerToken}` },
    body: JSON.stringify({ ...body, name }),
  });
  const results = await Promise.all(Array.from({ length: remaining + 2 }, (_, i) => post(`Concurrent branch ${i}`)));
  assert.equal(results.filter(result => result.status === 201).length, remaining);
  assert.equal(results.filter(result => result.status === 403).length, 2);
  for (const result of results.filter(result => result.status === 403)) {
    assert.equal((await result.json()).message, `Branch limit reached. Maximum ${limit} branches allowed.`);
  }
  assert.equal(await count(), limit);
  await ctx.direct('/__feature-license-test', { features: { BRANCH_STORE: { enabled: false } } });
  await ctx.api('/api/v1/branches');
  await ctx.api('/api/v1/branches', { body: { ...body, name: 'Cannot add on downgrade' }, roleToken: ctx.ownerToken, status: 403 });
  assert.equal(await count(), limit);
});
