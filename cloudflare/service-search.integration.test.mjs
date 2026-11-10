import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

test('branch and global service search support translated JSON fields on Workers', async t => {
  const { api, ownerToken, fixture } = await setup(t, 'true');
  await api(`/api/v1/services/${fixture.serviceId}`, { method: 'PATCH', roleToken: ownerToken, body: {
    name: 'Synthetic Base Cut', description: 'Synthetic base description',
    translations: { 'zh-CN': { name: 'HAIR Äther', description: 'Colour balance' }, 'zh-HK': { name: '髮型設計', description: '頭髮護理' } },
  } });
  for (const base of [`/api/v1/services/${fixture.branchId}/services`, '/api/v1/services']) {
    for (const q of ['hair', 'HAIR', 'äTHER', '髮型', 'hair balance', 'Synthetic']) {
      const response = await api(`${base}?q=${encodeURIComponent(q)}`);
      assert.ok(response.data.items.some(row => row.id === fixture.serviceId), `${base}: ${q}`);
    }
    const sorted = await api(`${base}?q=hair&sortBy=price_asc&limit=1`);
    assert.equal(sorted.data.items[0].id, fixture.serviceId);
    assert.equal(sorted.data.pagination.total, 1);
    const noMatch = await api(`${base}?q=no-such-synthetic-service`);
    assert.equal(noMatch.data.items.length, 0);
    assert.equal(noMatch.data.pagination.total, 0);
    const secondPage = await api(`${base}?q=hair&limit=1&page=2`);
    assert.equal(secondPage.data.items.length, 0);
    assert.equal(secondPage.data.pagination.total, 1);
  }
});
