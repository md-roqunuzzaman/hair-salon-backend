import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { signTencentModerationRequest, tencentModerationRequest, TENCENT_MODERATION_TIMEOUT_MS } from "./tencent-moderation.js";

// Independent official SDK signer is test-only; it does not import AbstractClient.
const require = createRequire(import.meta.url);
const officialSign = require("tencentcloud-sdk-nodejs/tencentcloud/common/sign.js").default;
const credentials = { secretId: "synthetic-id", secretKey: "synthetic-key", region: "ap-guangzhou" };
const data = { Suggestion: "Pass", Label: "Normal", SubLabel: "", Score: 0, RequestId: "synthetic-request" };

for (const action of ["TextModeration", "ImageModeration"] as const) for (const timestamp of [1551113065, 1761955199, 1761955200]) {
  test(`TC3 ${action} matches official SDK at UTC boundary ${timestamp}`, () => {
    const payload: Record<string, string> = action === "TextModeration" ? { Content: Buffer.from("中文 salon 🧴").toString("base64"), Type: "TEXT", BizType: "text_common" } : { FileUrl: "https://images.example.com/file?x=1&signed=synthetic", BizType: "image_common" };
    const signed = signTencentModerationRequest(action, payload, credentials, timestamp);
    const expected = officialSign.sign3({ method: "POST", url: signed.url, payload, timestamp, service: action === "TextModeration" ? "tms" : "ims", ...credentials, headers: { "Content-Type": "application/json; charset=utf-8" } });
    assert.ok(signed.headers.Authorization === expected, "TC3 authorization differs from the official signer (values suppressed)");
    assert.equal(signed.headers["X-TC-Version"], "2020-12-29");
    assert.equal(signed.headers["X-TC-Timestamp"], String(timestamp));
    assert.equal(signed.headers["X-TC-Action"], action);
    assert.deepEqual(JSON.parse(signed.body), payload);
  });
}

test("fetch uses fixed HTTPS origin, signed body, no redirects and an abort signal", async t => {
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(input, "https://tms.tencentcloudapi.com/");
    assert.equal(init!.method, "POST"); assert.equal(init!.redirect, "manual");
    assert.ok(init!.signal instanceof AbortSignal);
    assert.equal(JSON.parse(init!.body as string).Content, "c2FmZQ==");
    assert.ok(new Headers(init!.headers).get("authorization")!.startsWith("TC3-HMAC-SHA256 "));
    return Response.json({ Response: data });
  });
  assert.deepEqual(await tencentModerationRequest("TextModeration", { Content: "c2FmZQ==" }, credentials), data);
});

test("missing credentials and header injection fail before network I/O", async t => {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call network"); });
  for (const config of [{}, { ...credentials, secretId: "bad\r\nheader" }, { ...credentials, region: "bad\nregion" }]) {
    await assert.rejects(tencentModerationRequest("TextModeration", {}, config), { message: "TENCENT_MODERATION_UNAVAILABLE" });
  }
  assert.equal(network.mock.callCount(), 0);
});

for (const [label, make] of [
  ["HTTP rejection", () => new Response("synthetic-sensitive-provider-detail", { status: 403 })],
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://other.example.com" } })],
  ["non-JSON", () => new Response("<html>synthetic-sensitive-provider-detail</html>")],
  ["empty body", () => new Response(null)],
  ["error envelope", () => Response.json({ Response: { ...data, Error: { Code: "AuthFailure", Message: "synthetic-sensitive-provider-detail" } } })],
  ["malformed envelope", () => Response.json({ results: [data] })],
  ["oversized body", () => new Response("x".repeat(1024 * 1024 + 1))],
] as const) test(`transport ${label} rejects without raw provider details`, async t => {
  t.mock.method(globalThis, "fetch", async () => make());
  await assert.rejects(tencentModerationRequest("TextModeration", {}, credentials), { message: "TENCENT_MODERATION_UNAVAILABLE" });
});

for (const phase of ["headers", "body"] as const) test(`10-second deadline bounds ${phase} and aborts the request`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    signal = init!.signal;
    if (phase === "headers") return new Promise<Response>(() => {});
    return new Response(new ReadableStream({ start() {} }));
  });
  const request = tencentModerationRequest("ImageModeration", {}, credentials);
  const rejected = assert.rejects(request, { message: "TENCENT_MODERATION_UNAVAILABLE" });
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(TENCENT_MODERATION_TIMEOUT_MS);
  await rejected;
  assert.equal(signal!.aborted, true);
});

for (const [label, stage, status, providerCode, make] of [
  ["authentication", "PROVIDER", 200, "AuthFailure", () => Response.json({ Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "synthetic-private-content" } } })],
  ["unknown provider error", "PROVIDER", 200, undefined, () => Response.json({ Response: { Error: { Code: "synthetic-private-content", Message: "synthetic-private-content" } } })],
  ["HTTP rejection", "HTTP", 403, undefined, () => new Response("synthetic-private-content", { status: 403 })],
  ["invalid JSON", "BODY", 200, undefined, () => new Response("synthetic-private-content")],
  ["invalid envelope", "ENVELOPE", 200, undefined, () => Response.json({ private: "synthetic-private-content" })],
  ["network failure", "FETCH", undefined, undefined, () => { throw new Error("synthetic-private-content"); }],
] as const) test(`safe diagnostics distinguish ${label} without leaking private data`, async t => {
  const logs = t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => make());
  const error = await tencentModerationRequest("TextModeration", { Content: "synthetic-private-content" }, credentials).then(
    () => assert.fail("Expected unavailable"), error => error as Error & { code: string },
  );
  assert.equal(error.message, "TENCENT_MODERATION_UNAVAILABLE");
  assert.equal(error.code, `TENCENT_MODERATION_${stage}_FAILED`);
  assert.equal(logs.mock.callCount(), 1);
  assert.deepEqual(logs.mock.calls[0]!.arguments[1], { stage, code: error.code, httpStatus: status, providerCode });
  const serialized = JSON.stringify({ error, logs: logs.mock.calls.map(call => call.arguments) });
  for (const marker of [credentials.secretId, credentials.secretKey, "synthetic-private-content", "Authorization", "Signature="]) {
    assert.ok(!serialized.includes(marker), "Private moderation data leaked (value suppressed)");
  }
});
