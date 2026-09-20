import assert from "node:assert/strict";
import test from "node:test";
import { decode, JwtPayload } from "jsonwebtoken";
import { jwtUtils } from "./jwt.js";

const accessSecret = "access-secret-that-is-longer-than-thirty-two-characters";
const refreshSecret = "refresh-secret-that-is-longer-than-thirty-two-characters";
const payload = { userId: "user-1", email: "ada@example.com", role: "CUSTOMER" };

test("an access token verifies only with its signing secret", () => {
  const token = jwtUtils.createToken(payload, accessSecret, "15m");

  assert.equal(jwtUtils.verifyToken(token, accessSecret).success, true);
  assert.equal(jwtUtils.verifyToken(token, refreshSecret).success, false);
});

test("refresh tokens with different jti values are distinct", () => {
  const first = jwtUtils.createToken(
    { ...payload, jti: "session-one" },
    refreshSecret,
    "7d",
  );
  const second = jwtUtils.createToken(
    { ...payload, jti: "session-two" },
    refreshSecret,
    "7d",
  );
  const firstPayload = decode(first) as JwtPayload;
  const secondPayload = decode(second) as JwtPayload;

  assert.notEqual(first, second);
  assert.equal(firstPayload?.jti, "session-one");
  assert.equal(secondPayload?.jti, "session-two");
});
