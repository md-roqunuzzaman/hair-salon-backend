import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { getCountries, getExampleNumber } from 'libphonenumber-js';
import { authValidation } from '../src/app/module/auth/auth.validation.ts';
import { userValidation } from '../src/app/module/user/user.validation.ts';

const examples = createRequire(import.meta.url)('libphonenumber-js/examples.mobile.json');
const register = phone => authValidation.registerValidationSchema.safeParse({
  body: { name: 'Synthetic customer', email: 'phone@example.com', password: 'StrongPassword123!', ...(phone !== undefined && { phone }) },
});
const update = phone => userValidation.updateProfileValidationSchema.safeParse({ body: { phone } });

for (const [name, validate] of [['register', register], ['update-me', update]]) {
  test(`${name} accepts and normalizes synthetic examples for every supported country`, () => {
    assert.ok(getCountries().length >= 200);
    for (const country of getCountries()) {
      const example = getExampleNumber(country, examples);
      assert.ok(example?.isValid(), country);
      const result = validate(example.number);
      assert.equal(result.success, true, country);
      assert.equal(result.data.body.phone, example.number, country);
    }
  });
}

test('both phone validators canonicalize international display formatting to E.164', () => {
  for (const country of ['BD', 'HK', 'IN', 'CN', 'GB', 'US']) {
    const example = getExampleNumber(country, examples);
    for (const validate of [register, update]) {
      const result = validate(`  ${example.formatInternational()}  `);
      assert.equal(result.success, true, country);
      assert.equal(result.data.body.phone, example.number, country);
    }
  }
});

test('both phone validators reject invalid, local-only and incorrectly typed input', () => {
  for (const phone of ['', '12345', '91234567', '+999123456789', '+85212', null, 12345678, {}]) {
    assert.equal(register(phone).success, false);
    assert.equal(update(phone).success, false);
  }
});

test('phone remains optional while an empty profile update remains rejected', () => {
  assert.equal(register(undefined).success, true);
  const result = userValidation.updateProfileValidationSchema.safeParse({ body: { name: 'Synthetic name' } });
  assert.equal(result.success, true);
  assert.equal(result.data.body.phone, undefined);
  assert.equal(userValidation.updateProfileValidationSchema.safeParse({ body: {} }).success, false);
});
