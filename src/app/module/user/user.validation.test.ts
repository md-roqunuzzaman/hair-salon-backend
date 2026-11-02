import assert from "node:assert/strict";
import test from "node:test";
import { userValidation } from "./user.validation.js";

const password72 = "Aa1!" + "A".repeat(68);
const password73 = "Aa1!" + "A".repeat(69);

const unicode72 = "Aa1!" + "😀".repeat(17);
const unicode76 = "Aa1!" + "😀".repeat(18);

const payload = (newPassword: string, currentPassword = "OldPassword1!") => ({
  body: {
    currentPassword,
    newPassword,
  },
});

const validate = (newPassword: string, currentPassword?: string) =>
  userValidation.changePasswordValidationSchema.safeParse(
    payload(newPassword, currentPassword),
  );

test("S5: change password accepts exactly 72 ASCII bytes", () => {
  assert.equal(new TextEncoder().encode(password72).length, 72);

  const result = validate(password72);

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("S5: change password rejects 73 ASCII bytes", () => {
  assert.equal(new TextEncoder().encode(password73).length, 73);

  const result = validate(password73);

  assert.equal(result.success, false);

  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "body.newPassword" &&
          issue.message === "Password must not exceed 72 UTF-8 bytes",
      ),
    );
  }
});

test("S5: change password accepts exactly 72 Unicode UTF-8 bytes", () => {
  assert.equal(new TextEncoder().encode(unicode72).length, 72);

  const result = validate(unicode72);

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("S5: change password rejects Unicode password exceeding 72 bytes", () => {
  assert.equal(new TextEncoder().encode(unicode76).length, 76);

  const result = validate(unicode76);

  assert.equal(result.success, false);

  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "body.newPassword" &&
          issue.message === "Password must not exceed 72 UTF-8 bytes",
      ),
    );
  }
});

test("S5: existing oversized current password remains accepted", () => {
  const result = validate("NewPassword1!", password73);

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("S5: current password is required", () => {
  const result = userValidation.changePasswordValidationSchema.safeParse({
    body: {
      currentPassword: "",
      newPassword: "NewPassword1!",
    },
  });

  assert.equal(result.success, false);
});
