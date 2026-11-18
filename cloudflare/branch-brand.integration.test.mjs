import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

test('Worker supports nullable Brand.owner, inverse User.ownedBrands and SUPER_ADMIN enum without automatically seeding one', async t => {
  const ctx = await setup(t, 'true');
  const before = await ctx.direct('/__branch-brand-test', { ownerCheck: true });
  assert.equal(before.brand.ownerId, null);
  assert.equal(before.brand.owner, null);
  assert.deepEqual(before.owner.ownedBrands, []);
  const state = await ctx.state();
  const assigned = await ctx.direct('/__branch-brand-test', { ownerCheck: true, assignOwner: true });
  assert.equal(assigned.brand.ownerId, assigned.owner.id);
  assert.deepEqual(assigned.brand.owner, { id: assigned.owner.id, role: 'BRAND_OWNER' });
  assert.deepEqual(assigned.owner.ownedBrands, [{ id: assigned.brand.id, ownerId: assigned.owner.id }]);
  const admin = await ctx.direct('/__branch-brand-test', { superAdminCheck: true });
  assert.equal(admin.user.role, 'SUPER_ADMIN');
  assert.deepEqual(admin.user.ownedBrands, []);
  const after = await ctx.state();
  for (const key of ['payments','refunds','wallets','ledger','purchases','appointments']) assert.deepEqual(after[key], state[key]);
  assert.deepEqual(await ctx.direct('/__branch-brand-test', { ownerCheck: true }), assigned);
});

test('Worker nullable branch ownership and inverse Brand.branches relation work through the real Prisma adapter', async t => {
  const ctx = await setup(t, 'true');
  const before = await ctx.direct('/__branch-brand-test', { branchId: ctx.fixture.branchId });
  assert.equal(before.branch.brandId, null);
  assert.equal(before.branch.brand, null);
  const moneyBefore = await ctx.state();
  const linked = await ctx.direct('/__branch-brand-test', { branchId: ctx.fixture.branchId, assign: true });
  assert.equal(linked.branch.brandId, linked.brand.id);
  assert.deepEqual(linked.branch.brand, { id: linked.brand.id });
  assert.deepEqual(linked.brand.branches.find(row => row.id === ctx.fixture.branchId), { id: ctx.fixture.branchId, brandId: linked.brand.id });
  const moneyAfter = await ctx.state();
  for (const key of ['payments','refunds','wallets','ledger','purchases','appointments']) assert.deepEqual(moneyAfter[key], moneyBefore[key]);
  assert.deepEqual(await ctx.direct('/__branch-brand-test', { branchId: ctx.fixture.branchId }), linked);
});
