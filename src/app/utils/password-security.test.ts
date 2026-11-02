import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_BCRYPT_PASSWORD_BYTES,
  isWithinBcryptPasswordLimit,
  assertBcryptPasswordLength,
} from "./password-security.js";

// =====================================================
// S5: BCRYPT PASSWORD BYTE-LIMIT SECURITY TESTS
// =====================================================

test("S5: bcrypt maximum password length is 72 bytes", () => {
  assert.equal(MAX_BCRYPT_PASSWORD_BYTES, 72);
});

test("S5: accepts exactly 72 ASCII bytes", () => {
  const password = "A".repeat(72);

  assert.equal(isWithinBcryptPasswordLimit(password), true);

  assert.doesNotThrow(() => {
    assertBcryptPasswordLength(password);
  });
});

test("S5: rejects 73 ASCII bytes", () => {
  const password = "A".repeat(73);

  assert.equal(isWithinBcryptPasswordLimit(password), false);

  assert.throws(
    () => assertBcryptPasswordLength(password),
    /Password must not exceed 72 UTF-8 bytes/,
  );
});

test("S5: accepts 72 UTF-8 bytes of Unicode", () => {
  // Each emoji occupies 4 UTF-8 bytes.
  const password = "😀".repeat(18);

  assert.equal(new TextEncoder().encode(password).length, 72);

  assert.equal(isWithinBcryptPasswordLimit(password), true);
});

test("S5: rejects Unicode password exceeding 72 bytes", () => {
  const password = "😀".repeat(19);

  assert.equal(new TextEncoder().encode(password).length, 76);

  assert.equal(isWithinBcryptPasswordLimit(password), false);

  assert.throws(
    () => assertBcryptPasswordLength(password),
    /Password must not exceed 72 UTF-8 bytes/,
  );
});

test("S5: rejects mixed ASCII and Unicode exceeding 72 bytes", () => {
  const password = "A".repeat(69) + "😀";

  // 69 ASCII bytes + 4 emoji bytes = 73 bytes.
  assert.equal(new TextEncoder().encode(password).length, 73);

  assert.equal(isWithinBcryptPasswordLimit(password), false);
});
