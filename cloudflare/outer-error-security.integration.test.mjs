import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setup } from './test-support/public-worker.mjs';

test('Outer Worker errors match Helmet values and retain JSON, redaction, CORS and cookie behavior', async t => {
  const ctx = await setup(t);
  const expectedHeaders = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'cross-origin-opener-policy': 'same-origin',
  };
  const express = await ctx.fetch('https://test/', { headers: { origin: 'https://frontend.example.com' } });
  assert.equal(express.status, 200);
  await express.text();
  for (const [route, status] of [['/__internal/cron', 404], ['/__setup', 404], ['/__worker-error', 500]]) {
    const response = await ctx.fetch('https://test' + route, { headers: { origin: 'https://frontend.example.com' } });
    assert.equal(response.status, status);
    for (const [name, value] of Object.entries(expectedHeaders)) {
      assert.equal(response.headers.get(name), value, `${route}: ${name}`);
      assert.equal(response.headers.get(name), express.headers.get(name));
    }
    // Outer errors previously had no CORS/cookie policy; retain that boundary.
    for (const name of ['access-control-allow-origin', 'access-control-allow-credentials', 'set-cookie',
      'x-powered-by', 'content-security-policy', 'cross-origin-resource-policy']) {
      assert.equal(response.headers.get(name), null, `${route}: ${name}`);
    }
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), {
      success: false, statusCode: status,
      name: status === 404 ? 'Not Found' : 'Internal Server Error',
      message: status === 404 ? 'Route not found' : 'Internal Server Error',
    });
  }
});

test('Production Worker embeds the current outer-error helper and excludes its synthetic failure fixture', async () => {
  const map = JSON.parse(await readFile('cloudflare/.build/worker.mjs.map', 'utf8'));
  const file = 'cloudflare/runtime/errors.mjs';
  const i = map.sources.findIndex(source => path.resolve('cloudflare/.build', source) === path.resolve(file));
  assert.ok(i >= 0);
  assert.equal(map.sourcesContent[i].replaceAll('\r\n', '\n'), (await readFile(file, 'utf8')).replaceAll('\r\n', '\n'));
  const bundle = await readFile('cloudflare/.build/worker.mjs', 'utf8');
  for (const marker of ['__worker-error', '__security-test-control', '__auth-session-test', '__login-rate-test']) {
    assert.ok(!bundle.includes(marker), 'Test control leaked into production Worker');
  }
  assert.ok(!map.sources.some(source => /(?:fixture|\.test)\.mjs$/.test(source)));
});
