import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';

test('native workerd Tencent transport accepts signed requests and refuses redirects without forwarding credentials', async t => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'synthetic-tencent-worker.ts', contents: `
      import { tencentModerationRequest } from './src/app/lib/tencent-moderation.ts';
      export default { async fetch(request) {
        const image = new URL(request.url).pathname === '/image';
        try {
          const result = await tencentModerationRequest(image ? 'ImageModeration' : 'TextModeration',
            image ? { FileUrl: 'https://images.example.com/synthetic.jpg' } : { Content: 'c3ludGhldGlj', Type: 'TEXT' },
            { secretId: 'synthetic-id', secretKey: 'synthetic-key', region: 'ap-guangzhou' });
          return Response.json({ suggestion: result.Suggestion });
        } catch (error) { return Response.json({ code: error.code }, { status: 503 }); }
      } };
    ` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto'],
  });
  let status = 200;
  const hosts = [];
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, log: new Log(LogLevel.NONE),
    compatibilityDate: '2025-10-11', compatibilityFlags: ['nodejs_compat'],
    outboundService: async request => {
      const host = new URL(request.url).hostname;
      hosts.push(host);
      assert.ok(['tms.tencentcloudapi.com', 'ims.tencentcloudapi.com'].includes(host), 'Signed request followed a redirect');
      assert.equal(request.method, 'POST');
      assert.ok(request.headers.get('authorization')?.startsWith('TC3-HMAC-SHA256 '));
      if (status !== 200) return new Response(null, { status, headers: { location: 'https://untrusted.example.com/redirect' } });
      return Response.json({ Response: { Suggestion: 'Pass', Label: 'Normal', SubLabel: null, Score: 0, RequestId: 'synthetic-request' } });
    },
  });
  t.after(() => mf.dispose());
  for (const path of ['/text', '/image']) {
    const before = hosts.length;
    const response = await mf.dispatchFetch('https://test' + path);
    assert.equal(response.status, 200, 'Native Worker fetch must reach the mocked provider');
    assert.deepEqual(await response.json(), { suggestion: 'Pass' });
    assert.equal(hosts.length, before + 1);
  }
  for (status of [301, 302, 303, 307, 308]) {
    const before = hosts.length;
    const response = await mf.dispatchFetch('https://test/text');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'TENCENT_MODERATION_HTTP_FAILED' });
    assert.equal(hosts.length, before + 1, 'Redirect must never send a second request');
  }
});
