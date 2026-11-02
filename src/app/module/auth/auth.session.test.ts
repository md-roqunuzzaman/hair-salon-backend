import assert from "node:assert/strict";
import test from "node:test";
import { decode, type JwtPayload } from "jsonwebtoken";
import bcrypt from "bcrypt";

Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
  REDIS_URL: "redis://127.0.0.1:1", JWT_ACCESS_SECRET: "test-access-secret-".repeat(3),
  JWT_REFRESH_SECRET: "test-refresh-secret-".repeat(3), STRIPE_SECRET_KEY: "sk_test_fixture",
  R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test",
  R2_BUCKET_NAME: "test", OPENAI_API_KEY: "test-key",
});
const { prisma } = await import("../../lib/prisma.js");
const { redisClient } = await import("../../lib/redis.js");
const { authService, invalidateUserRefreshSessions } = await import("./auth.service.js");
const { jwtUtils } = await import("../../utils/jwt.js");
const user = { id: "synthetic-user", email: "synthetic@example.com", name: "Synthetic", role: "CUSTOMER", status: "ACTIVE", emailVerified: true, mustChangePassword: false, passwordHash: "mocked-hash" };
const failure = (status: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, status);
  assert.doesNotMatch(String(error), /private storage detail/);
  return true;
};

test("Node S4 service uses matching session claims, exact-valid Lua and safe failure responses", async t => {
  const original = prisma.user.findUnique;
  prisma.user.findUnique = (async () => user) as unknown as typeof original;
  t.after(() => { prisma.user.findUnique = original; });
  t.mock.method(bcrypt, "compare", async () => true);
  t.mock.method(redisClient, "del", async () => 1);
  const set = t.mock.method(redisClient, "set", async () => "OK");
  const evalMock = t.mock.method(redisClient, "eval", async () => 1);
  const session = await authService.loginUser({ email: user.email, password: "SyntheticPassword123!" });
  const access = decode(session.accessToken) as JwtPayload;
  const refresh = decode(session.refreshToken) as JwtPayload;
  assert.equal(access.sid, refresh.jti);
  const write = set.mock.calls[0]!.arguments as unknown as [string, string, { expiration: { type: string; value: number } }];
  assert.equal(write[0], `auth:refresh:${user.id}:${refresh.jti}`);
  assert.equal(write[1], "valid");
  assert.equal(write[2].expiration.type, "EX");
  assert.ok(write[2].expiration.value > 0 && write[2].expiration.value <= refresh.exp! - refresh.iat!);
  await authService.refreshToken(session.refreshToken);
  const rotation = evalMock.mock.calls[0]!.arguments as unknown as [string, { keys: string[]; arguments: string[] }];
  assert.match(rotation[0], /GET", KEYS\[1\]\) == "valid"/);
  assert.equal(rotation[1].keys[0], write[0]);
  assert.notEqual(rotation[1].keys[1], write[0]);
  assert.ok(Number(rotation[1].arguments[0]) > 0);
  evalMock.mock.mockImplementation(async () => 0);
  await assert.rejects(authService.refreshToken(session.refreshToken), failure(401));
  evalMock.mock.mockImplementation(async () => 2);
  await assert.rejects(authService.refreshToken(session.refreshToken), failure(503));
  evalMock.mock.mockImplementation(async () => { throw new Error("private storage detail"); });
  await assert.rejects(authService.refreshToken(session.refreshToken), failure(503));
  await assert.rejects(invalidateUserRefreshSessions(user.id), failure(503));
  set.mock.mockImplementation(async () => null);
  await assert.rejects(authService.loginUser({ email: user.email, password: "SyntheticPassword123!" }), failure(503));
  set.mock.mockImplementation(async () => { throw new Error("private storage detail"); });
  await assert.rejects(authService.loginUser({ email: user.email, password: "SyntheticPassword123!" }), failure(503));
});

test("Node S4 revocation uses a user-scoped pattern and logout never reports success after DEL failure", async t => {
  const evalMock = t.mock.method(redisClient, "eval", async () => 1);
  await invalidateUserRefreshSessions(user.id);
  const call = evalMock.mock.calls[0]!.arguments as unknown as [string, { keys: string[]; arguments: string[] }];
  assert.match(call[0], /redis.call\("SCAN"/);
  assert.deepEqual(call[1], { keys: [], arguments: [`auth:refresh:${user.id}:*`] });
  evalMock.mock.mockImplementation(async () => 0);
  await assert.rejects(invalidateUserRefreshSessions(user.id), failure(503));
  t.mock.method(redisClient, "del", async () => { throw new Error("private storage detail"); });
  const token = jwtUtils.createToken({ userId: user.id, jti: "session" }, process.env.JWT_REFRESH_SECRET!, "5m");
  await assert.rejects(authService.logoutUser(user.id, token), failure(503));
  await assert.rejects(authService.logoutUser("another-user", token), failure(401));
});
