import assert from "node:assert/strict";
import test from "node:test";
import type { CookieOptions, Response } from "express";
import { setAuthCookies } from "./auth-cookies.js";
import { jwtUtils } from "./jwt.js";

const secret = "test-secret-longer-than-thirty-two-characters";

test("one-day access and seven-day refresh cookies follow JWT expiry", () => {
  const access = jwtUtils.createToken({ userId: "user-1" }, secret, "1d");
  const refresh = jwtUtils.createToken({ userId: "user-1" }, secret, "7d");
  const cookies = new Map<string, CookieOptions>();
  const res = {
    cookie: (name: string, value: string, options: CookieOptions) => {
      assert.equal(value, name === "accessToken" ? access : refresh);
      cookies.set(name, options);
    },
  } as unknown as Response;
  setAuthCookies(res, access, refresh);
  const accessOptions = cookies.get("accessToken")!;
  const refreshOptions = cookies.get("refreshToken")!;
  assert.ok(accessOptions.maxAge! >= 86_399_000 && accessOptions.maxAge! <= 86_400_000);
  assert.ok(refreshOptions.maxAge! >= 604_799_000 && refreshOptions.maxAge! <= 604_800_000);
  assert.equal(accessOptions.httpOnly, true);
  assert.equal(refreshOptions.httpOnly, true);
});

test("existing tokens use their remaining lifetime instead of a fresh full lifetime", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = jwtUtils.createToken({ iat: now - 3600 }, secret, "2h");
  const remaining = jwtUtils.getRemainingLifetimeSeconds(token);
  assert.ok(remaining >= 3599 && remaining <= 3600);
});

test("different refresh lifetimes produce matching Redis TTL values", () => {
  const token = jwtUtils.createToken({ userId: "user-1" }, secret, "30m");
  const ttl = jwtUtils.getRemainingLifetimeSeconds(token);
  assert.ok(ttl >= 1799 && ttl <= 1800);
});

test("missing expiry and expired tokens cannot create session lifetimes", () => {
  assert.throws(() => jwtUtils.getRemainingLifetimeSeconds("invalid"), /valid expiry/);
  const token = jwtUtils.createToken({ userId: "user-1" }, secret, "-1s");
  assert.throws(() => jwtUtils.getRemainingLifetimeSeconds(token), /already expired/);
});
