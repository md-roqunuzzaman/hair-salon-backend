import { assertRedacted, captureLogs, serve, stubDelegate } from './test-support/node-security.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

const { default: app } = await import('../src/app.ts');
const { prisma } = await import('../src/app/lib/prisma.ts');
const { redisClient } = await import('../src/app/lib/redis.ts');
const { startMicrosoftAuthorization } = await import('../src/app/module/brand-email-setting/brand-email-setting.microsoft.ts');
const frontend = 'https://frontend.example.com';
const brandId = '11111111-1111-4111-8111-111111111111';

function markers() {
  const names = ['code', 'state', 'access_token', 'refresh_token', 'password', 'header', 'cookie', 'body'];
  return Object.fromEntries(names.map(name => [name, randomUUID()]));
}
function query(values) { return new URLSearchParams(Object.entries(values).filter(([name]) => !['header', 'cookie', 'body'].includes(name))); }
function checkHeaders(response) {
  const expected = {
    'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains', 'cross-origin-opener-policy': 'same-origin',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(response.headers.get(name), value, name);
  for (const name of ['x-powered-by', 'content-security-policy', 'cross-origin-resource-policy']) assert.equal(response.headers.get(name), null, name);
}

test('S7 application logger retains method/path/time while redacting query, headers, cookies and body', async t => {
  const logs = captureLogs(t), base = await serve(t, app), secrets = markers();
  const headers = { authorization: `Bearer ${secrets.header}`, cookie: `accessToken=${secrets.cookie}; refreshToken=${secrets.refresh_token}`, 'content-type': 'application/json' };
  const root = await fetch(`${base}/?${query(secrets)}`, { headers });
  assert.equal(root.status, 200); await root.text();
  const missing = await fetch(`${base}/__security-missing?${query(secrets)}`, { method: 'POST', headers, body: JSON.stringify({ secret: secrets.body, accessToken: secrets.access_token }) });
  assert.equal(missing.status, 404); await missing.text();
  assertRedacted(logs, Object.values(secrets));
  const values = logs.flatMap(log => log.args);
  assert.ok(values.includes('METHOD:') && values.includes('GET') && values.includes('POST'));
  assert.ok(values.includes('PATH:') && values.includes('/') && values.includes('/__security-missing'));
  const times = logs.filter(log => log.args[0] === 'TIME:');
  assert.equal(times.length, 2);
  assert.ok(times.every(log => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(log.args[1])));
});

test('S7 branch appointment debug logger must not leak query secrets before authentication', async t => {
  const logs = captureLogs(t), base = await serve(t, app), secrets = markers();
  const response = await fetch(`${base}/api/v1/branches/${brandId}/appointments?${query(secrets)}`);
  assert.equal(response.status, 401); await response.text();
  assertRedacted(logs, Object.values(secrets));
});

test('S7 availability must not log the unfiltered request query object', async t => {
  const logs = captureLogs(t), base = await serve(t, app), secrets = markers();
  stubDelegate(t, prisma, 'branch', 'findUnique', async () => null);
  const values = query(secrets);
  values.set('branchId', brandId); values.set('serviceId', '22222222-2222-4222-8222-222222222222'); values.set('date', '2030-11-15');
  const response = await fetch(`${base}/api/v1/availability?${values}`);
  assert.equal(response.status, 404); await response.text();
  assertRedacted(logs, Object.values(secrets));
});

test('S7 OAuth callback retains code/state exchange, one-use state and response contract without logging secrets', async t => {
  const logs = captureLogs(t), base = await serve(t, app);
  const secrets = markers(), stateStore = new Map(), writes = [], requests = [];
  const setting = { id: 'setting', provider: 'MICROSOFT_365', configurationVersion: 1, fromEmail: 'merchant@example.com', isEnabled: false };
  stubDelegate(t, prisma, 'brandEmailSetting', 'findUnique', async () => setting);
  stubDelegate(t, prisma, 'brandEmailSetting', 'updateMany', async args => { writes.push(args); return { count: 1 }; });
  stubDelegate(t, prisma, 'brand', 'findMany', async () => [{ id: brandId }]);
  stubDelegate(t, prisma, 'user', 'findUnique', async () => ({ role: 'BRAND_OWNER', status: 'ACTIVE' }));
  t.mock.method(redisClient, 'set', async (key, value) => { stateStore.set(key, value); return 'OK'; });
  t.mock.method(redisClient, 'getDel', async key => { const value = stateStore.get(key); stateStore.delete(key); return value ?? null; });
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1') return originalFetch(input, init);
    requests.push({ url: url.href, init });
    if (url.hostname === 'login.microsoftonline.com') return Response.json({ access_token: secrets.access_token, refresh_token: secrets.refresh_token, expires_in: 3600, token_type: 'Bearer', scope: 'Mail.Send User.Read' });
    if (url.hostname === 'graph.microsoft.com' && url.pathname === '/v1.0/me') return Response.json({ id: 'account', mail: setting.fromEmail });
    throw new Error('Unexpected network access blocked');
  });
  const authorization = await startMicrosoftAuthorization(brandId, 'owner');
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');
  const values = new URLSearchParams({ state, code: secrets.code });
  const url = `${base}/api/v1/brand-email-settings/microsoft/callback?${values}`;
  const response = await fetch(url);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result, { success: true, statusCode: 200, message: 'Microsoft account authorized; provider remains disabled', data: { provider: 'MICROSOFT_365', isVerified: true, isEnabled: false, accountEmail: setting.fromEmail } });
  assert.equal(requests.length, 2);
  const exchange = requests[0].init.body;
  assert.equal(exchange.get('code'), secrets.code);
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.ok(exchange.get('code_verifier'));
  assert.equal(writes.length, 1);
  assert.ok(writes[0].data.oauthDataEncrypted.startsWith('v1:'));
  assertRedacted([logs, result, writes], [state, secrets.code, secrets.access_token, secrets.refresh_token]);
  const replay = await fetch(url);
  assert.equal(replay.status, 400); await replay.text();
  assert.equal(requests.length, 2);
  assertRedacted(logs, [state, ...Object.values(secrets)]);
});

test('S7 OAuth invalid-state errors also redact all query values', async t => {
  const logs = captureLogs(t), base = await serve(t, app), secrets = markers();
  const response = await fetch(`${base}/api/v1/brand-email-settings/microsoft/callback?${query(secrets)}`);
  assert.equal(response.status, 400);
  assertRedacted([logs, await response.json()], Object.values(secrets));
});

test('S7 source guard rejects direct request URL/header/body logging while allowing URL parsing', () => {
  const paths = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|mjs)$/.test(path) && !/\.test\.|-fixture\./.test(path)) paths.push(path);
    }
  };
  walk('src'); walk('cloudflare/runtime'); paths.push('cloudflare/worker.mjs');
  const unsafe = [];
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const visit = node => {
      if (ts.isCallExpression(node) && /^console\.(?:log|info|warn|error|debug)$/.test(node.expression.getText(source))) {
        const text = node.arguments.map(arg => arg.getText(source)).join(' ');
        if (/\b(?:req|request)\.(?:originalUrl|url|headers|cookies|body)\b/.test(text)) unsafe.push(path);
        if (path === 'src/test-moderation.ts' && text === 'error') unsafe.push(path);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(unsafe, [], 'Direct sensitive request logging remains');
  assert.ok(readFileSync('cloudflare/worker.mjs', 'utf8').includes('new URL(request.url).pathname'));
});

test('S8 Helmet headers and CORS remain present on health, API errors and parser failures', async t => {
  captureLogs(t);
  const base = await serve(t, app);
  for (const [url, init, status] of [
    ['/', {}, 200], ['/api/v1/__missing', {}, 404], ['/api/v1/users/me', {}, 401],
    ['/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, 400],
    ['/api/v1/payments/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 400],
  ]) {
    const response = await fetch(base + url, { ...init, headers: { origin: frontend, ...init.headers } });
    assert.equal(response.status, status);
    checkHeaders(response);
    assert.equal(response.headers.get('access-control-allow-origin'), frontend);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    const body = await response.json();
    if (url === '/') assert.deepEqual(body, { success: true, message: 'Welcome hair salon booking System Backend' });
    else { assert.equal(body.success, false); assert.equal(body.statusCode, status); assert.equal(typeof body.message, 'string'); }
  }
});

test('S8 credentialed CORS preflight remains unchanged and untrusted origins are not reflected', async t => {
  captureLogs(t);
  const base = await serve(t, app);
  const response = await fetch(`${base}/api/v1/auth/login`, { method: 'OPTIONS', headers: {
    origin: frontend, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type',
  } });
  assert.equal(response.status, 204);
  checkHeaders(response);
  assert.equal(response.headers.get('access-control-allow-origin'), frontend);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(response.headers.get('access-control-allow-headers'), 'authorization,content-type');
  const other = await fetch(base, { headers: { origin: 'https://untrusted.example.com' } });
  assert.equal(other.headers.get('access-control-allow-origin'), frontend);
  await other.text();
});

test('S8 Stripe raw-body verification still accepts a valid local signature and rejects tampering without writes', async t => {
  const logs = captureLogs(t), base = await serve(t, app), writes = [];
  stubDelegate(t, prisma, 'stripeWebhookEvent', 'findUnique', async () => null);
  stubDelegate(t, prisma, 'stripeWebhookEvent', 'create', async ({ data }) => { writes.push(data); return data; });
  const secretMarker = randomUUID();
  const time = Math.floor(Date.now() / 1000);
  const payload = ` {\n  "id": "evt_security_headers", "type": "account.updated", "data": { "object": { "note": "${secretMarker}" } }\n } `;
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${time}.${payload}`).digest('hex');
  const request = (body, header = `t=${time},v1=${signature}`) => fetch(`${base}/api/v1/payments/stripe/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header, origin: frontend }, body,
  });
  const accepted = await request(payload);
  assert.equal(accepted.status, 200); checkHeaders(accepted);
  assert.deepEqual(await accepted.json(), { received: true });
  assert.equal(writes.length, 1);
  const tampered = await request(payload.replace('account.updated', 'account.changed'));
  assert.equal(tampered.status, 400); checkHeaders(tampered);
  assert.equal((await tampered.json()).message, 'Invalid Stripe webhook signature');
  const rejected = await request(payload, 'invalid');
  assert.equal(rejected.status, 400); await rejected.text();
  assert.equal(writes.length, 1);
  assertRedacted(logs, [secretMarker, signature, process.env.STRIPE_WEBHOOK_SECRET]);
});
