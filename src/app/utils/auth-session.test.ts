import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  NODE_ENV: "test", REDIS_URL: "redis://127.0.0.1:1",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
  JWT_ACCESS_SECRET: "test-access-secret-".repeat(3),
  JWT_REFRESH_SECRET: "test-refresh-secret-".repeat(3),
});
const { redisClient } = await import("../lib/redis.js");
const { assertActiveAuthSession, withAuthSessionStorage } = await import("./auth-session.js");
const failure = (status: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, status);
  assert.doesNotMatch(String(error), /synthetic private detail/);
  return true;
};

test("session validation requires nonempty claims before any storage access", async t => {
  const read = t.mock.method(redisClient, "get", async () => "valid");
  for (const [user, session] of [["", "sid"], ["user", " "], [" ", "sid"]]) {
    await assert.rejects(assertActiveAuthSession(user!, session!), failure(401));
  }
  assert.equal(read.mock.callCount(), 0);
});

test("session validation accepts exactly valid and rejects missing or malformed state", async t => {
  const read = t.mock.method(redisClient, "get", async (key: string) => {
    assert.equal(key, "auth:refresh:user:sid");
    return "valid";
  });
  await assertActiveAuthSession("user", "sid");
  for (const value of [null, "", "revoked", "VALID"]) {
    read.mock.mockImplementation(async () => value);
    await assert.rejects(assertActiveAuthSession("user", "sid"), failure(401));
  }
});

test("session storage failure is a safe unavailable error, never an authentication bypass", async t => {
  t.mock.method(redisClient, "get", async () => { throw new Error("synthetic private detail"); });
  await assert.rejects(assertActiveAuthSession("user", "sid"), failure(503));
  await assert.rejects(withAuthSessionStorage(async () => { throw new Error("synthetic private detail"); }), failure(503));
  assert.equal(await withAuthSessionStorage(async () => 0), 0);
});
