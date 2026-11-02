import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { mock } from "node:test";
import type { Request, Response } from "express";
import { redisClient } from "../lib/redis.js";
import { AppError } from "../utils/app-error.js";
import { loginRateLimit, clearSuccessfulLoginAccountLimit } from "./login-rate-limit.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("login middleware uses shared atomic limits and fails closed without leaking storage errors", async t => {
  let reply: unknown = 0;
  let storageFailure = false;
  const calls: { script: string; keys: string[]; arguments: string[] }[] = [];
  const deleted: string[] = [];
  const evalMock = mock.method(redisClient, "eval", async (script: string, options: { keys: string[]; arguments: string[] }) => {
    calls.push({ script, ...options });
    if (storageFailure) throw new Error("redis://private:password@private-host");
    return reply;
  });
  const deleteMock = mock.method(redisClient, "del", async (key: string) => { deleted.push(key); return 1; });
  t.after(() => { evalMock.mock.restore(); deleteMock.mock.restore(); });

  const invoke = async (ip: string | undefined = "192.0.2.40") => {
    const headers: Record<string, string> = {};
    let result: unknown;
    let nextCalls = 0;
    await loginRateLimit(
      { ip, body: { email: " OWNER@Example.com " }, headers: { "x-forwarded-for": "198.51.100.9" } } as unknown as Request,
      { setHeader(name: string, value: string) { headers[name] = value; } } as unknown as Response,
      error => { result = error; nextCalls++; },
    );
    return { result, nextCalls, headers };
  };

  await t.test("valid reservation hashes normalized account and trusted IP with independent budgets", async () => {
    const outcome = await invoke();
    assert.equal(outcome.result, undefined);
    assert.equal(outcome.nextCalls, 1);
    assert.deepEqual(calls.at(-1)?.keys, [
      `rate-limit:login:account:${hash("owner@example.com")}`,
      `rate-limit:login:ip:${hash("192.0.2.40")}`,
    ]);
    assert.deepEqual(calls.at(-1)?.arguments, ["10", "30", "900"]);
    assert.match(calls.at(-1)!.script, /redis.call\("EXPIRE"/);
    assert.doesNotMatch(calls.at(-1)!.keys.join(), /owner@example|192\.0\.2/);
  });

  await t.test("blocked requests return 429 and Retry-After before authentication", async () => {
    reply = 897;
    const outcome = await invoke();
    assert.ok(outcome.result instanceof AppError);
    assert.equal(outcome.result.statusCode, 429);
    assert.equal(outcome.headers["Retry-After"], "897");
    assert.equal(outcome.nextCalls, 1);
  });

  await t.test("missing trusted IP is rejected without touching counters", async () => {
    const before = calls.length;
    const outcome = await invoke("");
    assert.ok(outcome.result instanceof AppError);
    assert.equal(outcome.result.statusCode, 400);
    assert.equal(calls.length, before);
  });

  await t.test("storage outage returns safe 503 without provider details", async () => {
    storageFailure = true;
    const outcome = await invoke();
    storageFailure = false;
    assert.ok(outcome.result instanceof AppError);
    assert.equal(outcome.result.statusCode, 503);
    assert.doesNotMatch(outcome.result.message, /private|password|redis:/);
  });

  await t.test("malformed storage replies cannot bypass the limiter", async () => {
    for (const invalid of [null, undefined, "0", "", -1, 0.5, NaN, Infinity]) {
      reply = invalid;
      const outcome = await invoke();
      assert.ok(outcome.result instanceof AppError);
      assert.equal(outcome.result.statusCode, 503);
    }
  });

  await t.test("successful login clears only normalized account budget, never IP budget", async () => {
    await clearSuccessfulLoginAccountLimit(" OWNER@Example.com ");
    assert.deepEqual(deleted, [`rate-limit:login:account:${hash("owner@example.com")}`]);
  });
});
